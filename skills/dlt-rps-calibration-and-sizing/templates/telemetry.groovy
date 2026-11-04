// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
// DLT calibration telemetry sampler (dlt-rps-calibration-and-sizing skill).
//
// Paste this script into a JSR223 Sampler (language groovy, cache compiled script on) inside a
// setUp Thread Group with 1 thread and 1 loop. scripts/make_calibration_plan.py does that for you.
// It starts a daemon thread and returns at once. The thread writes one CSV row per second to
// <dir>/telemetry.csv and one metadata file, telemetry-meta.json, where <dir> is the JMeter
// property dlt.telemetry.dir (default /tmp/artifacts). In DLT Native mode, every file at the top
// level of /tmp/artifacts is uploaded with the task's other artifacts.
//
// Every counter is written raw and cumulative; scripts/analyze_calibration.py computes the rates.
// Sources that do not exist on the host (cgroup files, or /proc outside Linux) are written as
// empty cells. The sampler marks its own sample as ignored, so it never appears in kpi.jtl or in
// DLT's results. Measured overhead on a 2 vCPU task: about 0.2 percent of task CPU and about
// 54 MB of container memory.
import java.lang.management.ManagementFactory
import java.lang.management.MemoryType
import org.apache.jmeter.threads.JMeterContextService

SampleResult.setIgnore()

def dir = new File(props.getProperty('dlt.telemetry.dir', '/tmp/artifacts'))
dir.mkdirs()

def readText = { String path -> def f = new File(path); f.canRead() ? f.text : null }
def firstReadable = { List<String> paths -> paths.find { new File(it).canRead() } }
def statValue = { String text, String key ->
    if (text == null) return null
    def line = text.readLines().find { it.startsWith(key + ' ') }
    line ? (line.split(/\s+/)[1] as long) : null
}

// cgroup v2 exposes one unified tree; v1 splits controllers across mounts.
def cgV2 = new File('/sys/fs/cgroup/cpu.stat').canRead() && new File('/sys/fs/cgroup/memory.current').canRead()
def cgV1CpuAcct = firstReadable(['/sys/fs/cgroup/cpuacct/cpuacct.usage', '/sys/fs/cgroup/cpu,cpuacct/cpuacct.usage'])
def cgV1CpuStat = firstReadable(['/sys/fs/cgroup/cpu/cpu.stat', '/sys/fs/cgroup/cpu,cpuacct/cpu.stat'])
def cgV1MemDir = firstReadable(['/sys/fs/cgroup/memory/memory.usage_in_bytes']) ? '/sys/fs/cgroup/memory' : null
def cgroupVersion = cgV2 ? 'v2' : (cgV1CpuAcct ? 'v1' : 'none')

def osBean = ManagementFactory.operatingSystemMXBean
def memBean = ManagementFactory.memoryMXBean
def threadBean = ManagementFactory.threadMXBean
def gcBeans = ManagementFactory.garbageCollectorMXBeans
def oldPool = ManagementFactory.memoryPoolMXBeans.find { it.type == MemoryType.HEAP && it.name.contains('Old') }
def isYoung = { String name -> name.contains('Young') || name.contains('Copy') || name.contains('Scavenge') }

// One-time metadata.
def meta = [
    startedAtMs        : System.currentTimeMillis(),
    javaVersion        : System.getProperty('java.version'),
    jvmArgs            : ManagementFactory.runtimeMXBean.inputArguments,
    maxHeapBytes       : memBean.heapMemoryUsage.max,
    availableProcessors: Runtime.runtime.availableProcessors(),
    cgroupVersion      : cgroupVersion,
    gcCollectors       : gcBeans*.name,
    oldGenPool         : oldPool?.name,
    cpuModel           : (readText('/proc/cpuinfo')?.readLines()?.find { it.startsWith('model name') || it.startsWith('CPU part') }?.split(':', 2)?.getAt(1)?.trim()),
]
def metadataUri = System.getenv('ECS_CONTAINER_METADATA_URI_V4')
if (metadataUri) {
    try {
        def task = new groovy.json.JsonSlurper().parse(new URL(metadataUri + '/task'))
        meta.taskArn = task.TaskARN
        meta.availabilityZone = task.AvailabilityZone
        meta.limits = task.Limits
        meta.launchType = task.LaunchType
    } catch (Exception e) {
        meta.metadataError = e.toString()
    }
}
new File(dir, 'telemetry-meta.json').text = groovy.json.JsonOutput.prettyPrint(groovy.json.JsonOutput.toJson(meta))

def columns = ['ts_ms', 'jmeter_active_threads', 'jvm_threads', 'process_cpu_ns',
               'heap_used', 'heap_committed', 'old_used', 'old_used_after_gc',
               'young_gc_count', 'young_gc_ms', 'old_gc_count', 'old_gc_ms',
               'cg_cpu_usage_us', 'cg_nr_throttled', 'cg_throttled_us', 'cg_mem_bytes', 'cg_mem_inactive_file',
               'net_rx_bytes', 'net_tx_bytes', 'tcp_inuse', 'tcp_tw', 'tcp_alloc']

def sample = {
    def row = [:]
    row.ts_ms = System.currentTimeMillis()
    row.jmeter_active_threads = JMeterContextService.threadCounts.activeThreads
    row.jvm_threads = threadBean.threadCount
    row.process_cpu_ns = (osBean.respondsTo('getProcessCpuTime') ? osBean.processCpuTime : null)
    def heap = memBean.heapMemoryUsage
    row.heap_used = heap.used
    row.heap_committed = heap.committed
    row.old_used = oldPool?.usage?.used
    row.old_used_after_gc = oldPool?.collectionUsage?.used
    def young = gcBeans.findAll { isYoung(it.name) }
    def old = gcBeans.findAll { !isYoung(it.name) }
    row.young_gc_count = young.sum(0L) { it.collectionCount }
    row.young_gc_ms = young.sum(0L) { it.collectionTime }
    row.old_gc_count = old.sum(0L) { it.collectionCount }
    row.old_gc_ms = old.sum(0L) { it.collectionTime }
    if (cgV2) {
        def cpu = readText('/sys/fs/cgroup/cpu.stat')
        row.cg_cpu_usage_us = statValue(cpu, 'usage_usec')
        row.cg_nr_throttled = statValue(cpu, 'nr_throttled')
        row.cg_throttled_us = statValue(cpu, 'throttled_usec')
        row.cg_mem_bytes = readText('/sys/fs/cgroup/memory.current')?.trim() as Long
        row.cg_mem_inactive_file = statValue(readText('/sys/fs/cgroup/memory.stat'), 'inactive_file')
    } else if (cgV1CpuAcct) {
        row.cg_cpu_usage_us = ((readText(cgV1CpuAcct)?.trim() as Long) ?: 0L).intdiv(1000)
        def cpu = cgV1CpuStat ? readText(cgV1CpuStat) : null
        row.cg_nr_throttled = statValue(cpu, 'nr_throttled')
        def throttledNs = statValue(cpu, 'throttled_time')
        row.cg_throttled_us = throttledNs != null ? throttledNs.intdiv(1000) : null
        if (cgV1MemDir) {
            row.cg_mem_bytes = readText(cgV1MemDir + '/memory.usage_in_bytes')?.trim() as Long
            row.cg_mem_inactive_file = statValue(readText(cgV1MemDir + '/memory.stat'), 'total_inactive_file')
        }
    }
    def netDev = readText('/proc/net/dev')
    if (netDev) {
        long rx = 0, tx = 0
        netDev.readLines().drop(2).each { line ->
            def parts = line.trim().split(/[:\s]+/)
            if (parts[0] != 'lo') { rx += parts[1] as long; tx += parts[9] as long }
        }
        row.net_rx_bytes = rx
        row.net_tx_bytes = tx
    }
    def sockstat = readText('/proc/net/sockstat')?.readLines()?.find { it.startsWith('TCP:') }
    if (sockstat) {
        def f = sockstat.split(/\s+/)
        def pick = { String key -> def i = f.findIndexOf { it == key }; i >= 0 ? f[i + 1] as long : null }
        row.tcp_inuse = pick('inuse')
        row.tcp_tw = pick('tw')
        row.tcp_alloc = pick('alloc')
    }
    columns.collect { row[it] == null ? '' : row[it].toString() }.join(',')
}

def out = new File(dir, 'telemetry.csv')
def worker = new Thread({
    out.withWriter('UTF-8') { w ->
        w.write(columns.join(',') + '\n')
        w.flush()
        while (true) {
            // Align to the next wall-clock second so rows join cleanly with other per-second data.
            long now = System.currentTimeMillis()
            Thread.sleep(1000L - (now % 1000L))
            try {
                w.write(sample() + '\n')
                w.flush()
            } catch (Exception e) {
                w.write('# sample error: ' + e.toString().replace('\n', ' ') + '\n')
                w.flush()
            }
        }
    }
} as Runnable, 'dlt-telemetry')
worker.daemon = true
worker.start()
log.info('dlt-rps-scaling telemetry sampler started, cgroup ' + cgroupVersion + ', writing ' + out)
