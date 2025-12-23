# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

#!/usr/bin/python
"""
jar_updater.py updates following jar files to address CVEs on the taurus image. 
This is not DLT application code. The script may be removed once taurus updates 
the libraries on the image.

Affected Jmeter jars:
    * json-smart v2.5.0 will be replaced with v2.5.2
    * neo4j-java-driver v4.12.0 will be replaced with v5.14.0
    * batik-script v1.14 will be replaced with v1.17
    * batik-bridge v1.14 will be replaced with v1.17
    * batik-transcoder v1.14 will be replaced with v1.17
    * lets-plot-batik v2.2.1 will be replaced with 4.2.0
    * commons-net v3.8.0 will be replaced with v3.9.0
    * tika-core v1.28.3 will be replaced with v3.2.2 (fixes CVE-2025-54988)
    * json-path v2.7.0 will be replaced with v2.9.0
    * dnsjava v2.1.9 will be replaced with v3.6.1
    * xstream will be replaced with v1.4.21
    * kotlin-stdlib will be replaced with v2.1.0
    * commons-lang3 will be replaced with v3.18.0
    * rhino v1.7.14 will be replaced with v1.7.14.1 (fixes CVE-2025-66453)
    * commons-lang v2.5 - no fix available for CVE-2025-48924

Also jmeter plugins manager will be updated to v1.11 to address CVEs and 
cmdrunner will be updated to v2.3 to accommodate with plugins manager.
"""

import os
import time
from pathlib import Path
from typing import Dict, List, Optional

import requests

from bzt.modules.jmeter import JarCleaner


# Constants
MAVEN_REPO_BASE_URL = "https://repo1.maven.org/maven2/"
MAVEN_SEARCH_BASE_URL = "https://search.maven.org/remotecontent?filepath="
JAR_FILE_EXTENSION = ".jar"
PLUGINS_MANAGER_WAIT_TIME = 5  # seconds
DOWNLOAD_CHUNK_SIZE = 8192

# Version constants
JMETER_VERSION = "5.6.3"
JMETER_PLUGINS_MANAGER_VERSION = "1.11"
CMD_RUNNER_VERSION = "2.3"

# These jars should be replaced with newer version in order to fix some vulnerabilities
# component name and download link in https://repo1.maven.org/maven2/
# These are Components with regards to JMETER
JMETER_COMPONENTS: Dict[str, str] = {
    "json-smart": "net/minidev/json-smart/2.5.2/json-smart-2.5.2.jar",
    "neo4j-java-driver": "org/neo4j/driver/neo4j-java-driver/5.14.0/neo4j-java-driver-5.14.0.jar",
    "batik-script": "org/apache/xmlgraphics/batik-script/1.17/batik-script-1.17.jar",
    "batik-bridge": "org/apache/xmlgraphics/batik-bridge/1.17/batik-bridge-1.17.jar",
    "batik-transcoder": "org/apache/xmlgraphics/batik-transcoder/1.17/batik-transcoder-1.17.jar",
    "lets-plot-batik": "org/jetbrains/lets-plot/lets-plot-batik/4.2.0/lets-plot-batik-4.2.0.jar",
    "commons-net": "commons-net/commons-net/3.9.0/commons-net-3.9.0.jar",
    "tika-core": "org/apache/tika/tika-core/3.2.2/tika-core-3.2.2.jar",
    "json-path": "com/jayway/jsonpath/json-path/2.9.0/json-path-2.9.0.jar",
    "dnsjava": "dnsjava/dnsjava/3.6.1/dnsjava-3.6.1.jar",
    "xstream": "com/thoughtworks/xstream/xstream/1.4.21/xstream-1.4.21.jar",
    "kotlin-stdlib": "org/jetbrains/kotlin/kotlin-stdlib/2.1.0/kotlin-stdlib-2.1.0.jar",
    "commons-lang3": "org/apache/commons/commons-lang3/3.18.0/commons-lang3-3.18.0.jar",
    "rhino": "org/mozilla/rhino/1.7.14.1/rhino-1.7.14.1.jar", # NOSONAR
}

# Jars to remove from the container
JARS_TO_REMOVE: List[str] = [
    "tika-parsers-1.28.5.jar"
]


def validate_components(components: Dict[str, str]) -> None:
    """
    Validate the structure of components dictionary.
    
    Args:
        components: Dictionary mapping component names to Maven paths
        
    Raises:
        ValueError: If components dictionary is invalid
    """
    if not components:
        raise ValueError("Components dictionary cannot be empty")
    
    for name, path in components.items():
        if not name or not isinstance(name, str):
            raise ValueError(f"Invalid component name: {name}")
        if not path or not isinstance(path, str):
            raise ValueError(f"Invalid path for component {name}: {path}")
        if not path.endswith(JAR_FILE_EXTENSION):
            raise ValueError(f"Component path must end with {JAR_FILE_EXTENSION}: {path}")


def build_maven_url(maven_path: str) -> str:
    """
    Build a complete Maven repository URL from a relative path.
    
    Args:
        maven_path: Relative path to the artifact in Maven repository
        
    Returns:
        Complete URL to download the artifact
    """
    return MAVEN_REPO_BASE_URL + maven_path


def build_plugins_manager_url(artifact: str, group_path: str, version: str) -> str:
    """
    Build a Maven search URL for plugins manager artifacts.
    
    Args:
        artifact: Artifact name (e.g., 'jmeter-plugins-manager')
        group_path: Group path (e.g., 'kg/apc')
        version: Version string
        
    Returns:
        Complete URL to download the artifact
    """
    return f"{MAVEN_SEARCH_BASE_URL}{group_path}/{artifact}/{version}/{artifact}-{version}.jar"


def download(url: str, target_path: str) -> None:
    """
    Download a file from a URL to a target path.
    
    Args:
        url: URL to download from
        target_path: Local file path to save the downloaded content
        
    Raises:
        requests.RequestException: If download fails
        IOError: If file write fails
    """
    try:
        response = requests.get(url, stream=True)
        response.raise_for_status()
        
        # Ensure parent directory exists
        Path(target_path).parent.mkdir(parents=True, exist_ok=True)
        
        # Write the content to a file
        with open(target_path, 'wb') as file:
            for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                file.write(chunk)
    except requests.RequestException as exc:
        raise requests.RequestException(f"Failed to download from {url}: {exc}") from exc
    except IOError as exc:
        raise IOError(f"Failed to write file to {target_path}: {exc}") from exc


class Platform:
    """
    Manages platform-specific jar updates and plugin installations.
    
    Attributes:
        obj: Platform-specific object (e.g., JMeter instance)
        lib_dir: Path to the platform's library directory
        affected_components: Dictionary of components to update
    """
    
    def __init__(
        self, 
        platform: str, 
        version: str, 
        affected_components: Optional[Dict[str, str]] = None
    ):
        """
        Initialize Platform with specified configuration.
        
        Args:
            platform: Platform name (e.g., 'JMeter', 'Gatling')
            version: Platform version string
            affected_components: Dictionary mapping component names to Maven paths
            
        Raises:
            ImportError: If platform module cannot be imported
            AttributeError: If platform class cannot be found
        """
        # To dynamically import from bzt.modules.gatling import Platform Objects
        module = __import__(f'bzt.modules.{platform.lower()}', fromlist=[platform])
        # Object created for the platform i.e JMeter(), Gatling()
        self.obj = getattr(module, platform)()
        self.lib_dir = Path(f"/root/.bzt/{platform.lower()}-taurus/{version}/lib")
        self.affected_components = affected_components or {}

    def install_jmeter_plugins(self) -> None:
        """
        Install JMeter plugins manager and command runner.
        
        Downloads and installs the plugins manager and command runner,
        then performs cleanup of duplicate jars.
        
        Raises:
            Exception: If plugin installation fails
        """
        plugins_mgr_link = build_plugins_manager_url(
            'jmeter-plugins-manager',
            'kg/apc',
            JMETER_PLUGINS_MANAGER_VERSION
        )
        command_runner_link = build_plugins_manager_url(
            'cmdrunner',
            'kg/apc',
            CMD_RUNNER_VERSION
        )
        
        plugins_mgr_name = os.path.basename(plugins_mgr_link)
        command_runner_name = os.path.basename(command_runner_link)
        
        pm_installer_path = self.lib_dir / 'ext' / plugins_mgr_name
        command_runner_path = self.lib_dir / command_runner_name
        
        self.obj.log.info(f"Installing JMeter plugins manager version {JMETER_PLUGINS_MANAGER_VERSION}")
        download(plugins_mgr_link, str(pm_installer_path))
        download(command_runner_link, str(command_runner_path))
        
        self.obj._JMeter__install_plugins_manager(str(pm_installer_path))
        
        cleaner = JarCleaner(self.obj.log)
        cleaner.clean(str(self.lib_dir / 'ext'))

    def update_jars(self) -> None:
        """
        Update affected jar files with newer versions.
        
        Scans the library directory for jars that need updating based on
        component names, downloads new versions, and cleans up old versions.
        
        Raises:
            ValueError: If affected_components is empty
            requests.RequestException: If download fails
        """
        if not self.affected_components:
            self.obj.log.warning("No components to update")
            return
        
        self.obj.log.info(f"Updating jars in {self.lib_dir}")
        
        jar_files = [
            _file for _file in os.listdir(str(self.lib_dir)) 
            if _file.endswith(JAR_FILE_EXTENSION)
        ]
        
        updated_count = 0
        for jar_file in jar_files:
            for comp_name in self.affected_components:
                if jar_file.startswith(comp_name):
                    download_link = build_maven_url(self.affected_components[comp_name])
                    target_path = self.lib_dir / os.path.basename(download_link)
                    
                    self.obj.log.info(f"Updating {comp_name}: {jar_file} -> {target_path.name}")
                    download(download_link, str(target_path))
                    updated_count += 1
                    break
        
        self.obj.log.info(f"Updated {updated_count} jar files")
        
        cleaner = JarCleaner(self.obj.log)
        cleaner.clean(str(self.lib_dir))

    def remove_jars(self, jars_to_remove: List[str]) -> None:
        """
        Remove specified jar files from the lib directory.
        
        Args:
            jars_to_remove: List of jar filenames to remove
        """
        if not jars_to_remove:
            self.obj.log.debug("No jars to remove")
            return
        
        for jar_name in jars_to_remove:
            jar_path = self.lib_dir / jar_name
            if jar_path.exists():
                jar_path.unlink()
                self.obj.log.info(f"Removed jar file: {jar_name}")
            else:
                self.obj.log.debug(f"Jar file not found, skipping: {jar_name}")


def main() -> None:
    """
    Main entry point for jar updater script.
    
    Processes all configured platforms, updates their jars, removes obsolete jars,
    and installs platform-specific plugins as needed.
    """
    # Validate configuration before processing
    validate_components(JMETER_COMPONENTS)
    
    # Update this map to add other platforms
    platform_components_map = {
        "JMeter": (JMETER_VERSION, JMETER_COMPONENTS)
    }
    
    for platform_name, (version, components) in platform_components_map.items():
        print(f"Processing platform: {platform_name} version {version}")
        
        platform = Platform(platform_name, version, components)
        platform.update_jars()
        platform.remove_jars(JARS_TO_REMOVE)
        
        if platform_name == "JMeter":
            platform.install_jmeter_plugins()
        
        print(f"Completed processing for {platform_name}")


if __name__ == "__main__":
    main()
