#!/bin/bash

set -eux

unset PREFIX
export NVM_DIR="/root/.nvm"
mkdir -p "$NVM_DIR"
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
. $NVM_DIR/nvm.sh
nvm install 16.15.0
npm install -g typescript yarn

mkdir -p /root/repo
cd /root/repo
git clone https://github.com/trilogy-group/pulse-alp .
