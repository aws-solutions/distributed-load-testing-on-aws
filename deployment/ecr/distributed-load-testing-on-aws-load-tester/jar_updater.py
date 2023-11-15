
import os
import time
import requests

from bzt.modules.jmeter import JarCleaner


"""
jar_updater.py updates json-smart, neo4j-java-driver, xalan to address CVEs on the taurus image. this is not DLT application code. 
the script may be removed once taurus updates the libraries on the image.
Affected Jmeter jars:
    * json-smart v2.4.8 will be replaced with v2.4.9
    * neo4j-java-driver v4.12.0 will be replaced with v5.14.0
    * xalan v2.7.2 will be replaced with v2.7.3
"""

# these jars should be replaced with newer version in order to fix some vulnerabilities
# component name and download link in https://repo1.maven.org/maven2/
# These are Components with regards to JMETER
JMETER_COMPONENTS = {
    "json-smart": "net/minidev/json-smart/2.4.9/json-smart-2.4.9.jar",
    "neo4j-java-driver": "org/neo4j/driver/neo4j-java-driver/5.14.0/neo4j-java-driver-5.14.0.jar",
    "xalan": "xalan/xalan/2.7.3/xalan-2.7.3.jar",
}
JMETER_VERSION = "5.4.3"

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
        plugins_mgr_version = "1.10"
        plugins_mgr_link = f'https://search.maven.org/remotecontent?filepath=kg/apc/jmeter-plugins-manager/{plugins_mgr_version}/jmeter-plugins-manager-{plugins_mgr_version}.jar'
        plugins_mgr_name = os.path.basename(plugins_mgr_link)
        pm_installer_path = os.path.join(self.lib_dir, 'ext', plugins_mgr_name)
        download(plugins_mgr_link, pm_installer_path)
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
    