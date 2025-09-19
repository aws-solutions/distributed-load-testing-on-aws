# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

#!/usr/bin/python
import os
import time
import requests

from bzt.modules.jmeter import JarCleaner

"""
jar_updater.py updates following jar files to address CVEs on the taurus image. this is not DLT application code. 
the script may be removed once taurus updates the libraries on the image.
Affected Jmeter jars:
    * json-smart v2.5.0 will be replaced with v2.5.2
    * neo4j-java-driver v4.12.0 will be replaced with v5.14.0
    * batik-script v1.14 will be replaced with v1.17
    * batik-bridge v1.14 will be replaced with v1.17
    * batik-transcoder v1.14 will be replaced with v1.17
    * lets-plot-batik v2.2.1 will be replaced with 4.2.0
    * commons-net v3.8.0 will be replaced with v3.9.0
    * tika-core v1.28.3 will be replaced with v1.28.4
    * json-path v2.7.0 will be replaced with v2.9.0
    * dnsjava v2.1.9 will be replaced with v3.6.1
    * xstream will be replaced with v1.4.21
    * http2-hpack will be replaced with v11.0.26
    * jetty-http will be replaced with v12.0.25
    * http2-common will be replaced with v11.0.26
    * kotlin-stdlib will be replaced with v2.1.0
    * commons-lang3 will be replaced with v3.18.0
    * commons-lang v2.5 - no fix available for CVE-2025-48924
Also jmeter plugins manager will be updated to v1.11 to address CVEs and cmdrunner will be updated to v2.3 to accomodate with plugins manager.
"""

# these jars should be replaced with newer version in order to fix some vulnerabilities
# component name and download link in https://repo1.maven.org/maven2/
# These are Components with regards to JMETER
JMETER_COMPONENTS = {
    "json-smart": "net/minidev/json-smart/2.5.2/json-smart-2.5.2.jar",
    "neo4j-java-driver": "org/neo4j/driver/neo4j-java-driver/5.14.0/neo4j-java-driver-5.14.0.jar",
    "batik-script": "org/apache/xmlgraphics/batik-script/1.17/batik-script-1.17.jar",
    "batik-bridge": "org/apache/xmlgraphics/batik-bridge/1.17/batik-bridge-1.17.jar",
    "batik-transcoder": "org/apache/xmlgraphics/batik-transcoder/1.17/batik-transcoder-1.17.jar",
    "lets-plot-batik":  "org/jetbrains/lets-plot/lets-plot-batik/4.2.0/lets-plot-batik-4.2.0.jar",
    "commons-net": "commons-net/commons-net/3.9.0/commons-net-3.9.0.jar",
    "tika-core": "org/apache/tika/tika-core/1.28.4/tika-core-1.28.4.jar",
    "json-path": "com/jayway/jsonpath/json-path/2.9.0/json-path-2.9.0.jar",
    "dnsjava": "dnsjava/dnsjava/3.6.1/dnsjava-3.6.1.jar",
    "xstream":"com/thoughtworks/xstream/xstream/1.4.21/xstream-1.4.21.jar",
    "http2-hpack": "org/eclipse/jetty/http2/http2-hpack/11.0.26/http2-hpack-11.0.26.jar",
    "jetty-http": "org/eclipse/jetty/jetty-http/12.0.25/jetty-http-12.0.25.jar",
    "http2-common": "org/eclipse/jetty/http2/http2-common/11.0.26/http2-common-11.0.26.jar",
    "kotlin-stdlib": "org/jetbrains/kotlin/kotlin-stdlib/2.1.0/kotlin-stdlib-2.1.0.jar",
    "commons-lang3": "org/apache/commons/commons-lang3/3.18.0/commons-lang3-3.18.0.jar",

}
JMETER_VERSION = "5.6.3"
JMETER_PLUGINS_MANAGER_VERSION = "1.11"
CMD_RUNNER_VERSION = "2.3"
# To add other platform, and what to update, add affected components and version HERE

def download(url, target_path):
    response = requests.get(url, stream=True)
    response.raise_for_status()
    # Write the content to a file
    with open(target_path, 'wb') as file:
        for chunk in response.iter_content(chunk_size=8192):
            file.write(chunk)

class Platform:
    def __init__(self, platform, version, affected_components=None):
        # To dynamically import from bzt.modules.gatling import Platform Objects
        module = __import__('bzt.modules.' + platform.lower(), fromlist=[platform])
        # Object created for the platform i.e JMeter(), Gatling()
        self.obj = getattr(module, platform)()
        self.lib_dir = f"/root/.bzt/{platform.lower()}-taurus/{version}/lib"
        self.affected_components = affected_components

    def install_jmeter_plugins(self):
        plugins_mgr_link = f'https://search.maven.org/remotecontent?filepath=kg/apc/jmeter-plugins-manager/{JMETER_PLUGINS_MANAGER_VERSION}/jmeter-plugins-manager-{JMETER_PLUGINS_MANAGER_VERSION}.jar'
        command_runner_link = f'https://search.maven.org/remotecontent?filepath=kg/apc/cmdrunner/{CMD_RUNNER_VERSION}/cmdrunner-{CMD_RUNNER_VERSION}.jar'
        plugins_mgr_name = os.path.basename(plugins_mgr_link)
        command_runner_name = os.path.basename(command_runner_link)
        pm_installer_path = os.path.join(self.lib_dir, 'ext', plugins_mgr_name)
        command_runner_path = os.path.join(self.lib_dir, command_runner_name)
        download(plugins_mgr_link, pm_installer_path)
        download(command_runner_link, command_runner_path)
        self.obj._JMeter__install_plugins_manager(pm_installer_path)
        cleaner = JarCleaner(self.obj.log)
        cleaner.clean(os.path.join(self.lib_dir, 'ext'))

    def _install_plugins(self):
        dest = os.path.dirname(self.lib_dir)
        plugins_manager_cmd = os.path.join(dest, 'bin', 'PluginsManagerCMD.sh')
        cmd_line = [plugins_manager_cmd, 'install', ",".join([])]

        try:
            out, err = self.obj.call(cmd_line)
        except Exception as exc:
            raise Exception(f"Failed to install plugins : {exc}") #NOSONAR

        self.log.debug("Install plugins: %s / %s", out, err)

        if out and "Plugins manager will apply some modifications" in out:
            time.sleep(5) 

    def update_jars(self):
        jar_files = [_file for _file in os.listdir(self.lib_dir) if _file.endswith(".jar")]
        for jar_file in jar_files:
            for comp_name in self.affected_components:
                if jar_file.startswith(comp_name):
                    download_link = "https://repo1.maven.org/maven2/" + self.affected_components[comp_name]
                    target_path = os.path.join(self.lib_dir, os.path.basename(download_link))
                    download(download_link, target_path)
                    break
                
        cleaner = JarCleaner(self.obj.log)
        cleaner.clean(self.lib_dir)


if __name__ == "__main__":
    # update this map to add other platforms
    platform_components_map = {"JMeter": (JMETER_VERSION, JMETER_COMPONENTS)}
    for key, value in platform_components_map.items():
        platform = Platform(key, value[0], value[1])
        platform.update_jars()
        if key == "JMeter":
            platform.install_jmeter_plugins()
    