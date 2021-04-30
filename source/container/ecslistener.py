# Copyright 2021 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: Apache-2.0

#!/usr/bin/python
from socket import socket, AF_INET, SOCK_STREAM

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
    #get port number
    port_number = 50000
    
    #create socket
    server_socket = socket(AF_INET, SOCK_STREAM)
    
    #bind socket
    server_socket.bind(("", port_number))
    
    print("Listening for start mesage")
    
    #listen for incoming connection
    server_socket.listen(1)
        
    #connect and receive messaging
    messaging(server_socket)
    
    #close socket
    server_socket.close()