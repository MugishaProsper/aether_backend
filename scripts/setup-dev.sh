#!/bin/bash

# Development setup script
echo "Setting up E-commerce Backend Development Environment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js 20 or later."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "Node.js version 20 or later is required. Current version: $(node -v)"
    exit 1
fi

# Check if Docker is installed and running
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker."
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "Docker is not running. Please start Docker."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "Docker Compose is not available. Please install Docker Compose."
    exit 1
fi

# Create environment file if it doesn't exist
if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo "Please edit .env file with your configuration values."
fi

# Create necessary directories
echo "Creating necessary directories..."
mkdir -p logs uploads temp

# Install dependencies
echo "Installing dependencies..."
npm install

# Start services with Docker Compose
echo "Starting development services..."
if command -v docker-compose &> /dev/null; then
    docker-compose up -d mongodb redis redis-commander mongo-express
else
    docker compose up -d mongodb redis redis-commander mongo-express
fi

# Wait for services to be ready
echo "Waiting for services to be ready..."
sleep 10

# Run database migrations/setup
echo "Setting up database..."
# This would run any migration scripts if needed

# Install global tools (optional)
echo "Installing development tools..."
npm install -g nodemon

echo ""
echo "✅ Development environment setup complete!"
echo ""
echo "Services running:"
echo "  - MongoDB: http://localhost:27017"
echo "  - Redis: localhost:6379"
echo "  - Mongo Express: http://localhost:8082"
echo "  - Redis Commander: http://localhost:8081"
echo ""
echo "To start the application:"
echo "  npm run dev"
echo ""
echo "To start background workers:"
echo "  npm run worker"
echo ""
echo "To view logs:"
echo "  docker-compose logs -f"