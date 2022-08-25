# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

#!/usr/bin/python
import socket
import sys
import signal

def recv_message(connection_socket):
    """receive a message on input socket and return"""
    sentence = connection_socket.recv(1024)
    return sentence

def messaging(server_socket):
    """Accept a message on a given socket and return message"""
    connection_socket, addr = server_socket.accept()

    #decode message
    message = recv_message(connection_socket).decode()
    print("Received: " + message)
    i = 0

    #Keep listening for message if not start (Limit 5 messages)
    while(message != "start" and i < 5):  
      print("message " + i + ": " + message)
      #Get message from client
      message = recv_message(connection_socket).decode()
      i += 1
        
if __name__ == "__main__":
    #get timeout
    timeout = sys.argv[1]
    
    #get port number
    port_number = 50000
    
    #create socket
    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

    #set reuseaddr option to avoid socket in use error
    server_socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    
    #set timeout
    server_socket.settimeout(int(timeout))

    #handle signal when container is terminated in order to properly close socket
    def signal_handler(sig, frame):
      print('container terminated, closing socket..')
      server_socket.close()
      print('socket closed')
      sys.exit(143) #128 + 15

    signal.signal(signal.SIGTERM, signal_handler)

    #bind socket
    server_socket.bind(("", port_number))
    
    print("Listening for start mesage")
    
    #listen for incoming connection
    server_socket.listen(1)
    
    try: 
      #connect and receive messaging
      messaging(server_socket)
    except socket.timeout:
      print('socket timed out, closing socket and starting test.')
      server_socket.close()
      exit(0)

    #close socket
    server_socket.close()