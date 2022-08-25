# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

#!/usr/bin/python
from multiprocessing import Pool
import socket
from functools import partial
import sys
   
def request_socket(ip_host, ip_net):
    """Create a socket and send a message over created socket"""
    msg = ""
    server_port = 50000
    server_name = ip_net + "." + ip_host

    #Create socket and connect
    client_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    client_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    client_socket.connect((server_name, int(server_port)))

    #message to send
    msg="start"

    #Send Message
    client_socket.send(msg.encode())

    #Close socket
    client_socket.close()
   
if __name__ == "__main__":
    # Parse ip addresses
    ip_hosts = sys.argv[2]
    ip_network = sys.argv[1]
    
    ip_hosts_list = ip_hosts.split(',')

    print("Sending start message to IP Addresses...")

    #Create socket for each IP and send commands
    pool = Pool()
    request_socket_modified = partial(request_socket, ip_net=ip_network) 
    pool.map(request_socket_modified, ip_hosts_list)

    print("Start messages sent successfuly.")

