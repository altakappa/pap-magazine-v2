#!/bin/bash
cd ~/Downloads/PAP_Magazine_Deploy
rm -f .git/index.lock
git add -A
git commit -m "${1:-update}"
git push
