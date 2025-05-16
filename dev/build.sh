#!/bin/bash

# Check if NVM is installed
if ! command -v nvm &>/dev/null; then
    echo "NVM not found. Installing NVM..."
    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash

    # Source NVM to make it available in the current shell
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
    echo "NVM installed successfully."
else
    echo "NVM is already installed."
fi

# Install and use Node.js 18
echo "Installing and activating Node.js 18..."
nvm install 18
nvm use 18
node -v

# Navigate to web directory
cd /var/www

# Remove old application directory if exists
sudo rm -rf vlsm-interfacing

# Clone repository
echo "Cloning repository..."
git clone https://github.com/deforay/vlsm-interfacing
cd vlsm-interfacing/

# Clean existing node modules and lock files
echo "Cleaning existing node modules and lock files..."
rm -rf node_modules/ app/node_modules/ package-lock.json app/package-lock.json

# Install dependencies and rebuild native modules
echo "Installing dependencies..."
npm i && npm run postinstall

# Build electron application
echo "Building electron application..."
npm run electron:build

echo "Build process completed successfully!"
