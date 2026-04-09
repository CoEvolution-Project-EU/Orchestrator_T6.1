# ── Build stage ──────────────────────────────────────────────
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files first (better Docker layer caching)
# If package.json didn't change, npm install is skipped
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install dependencies
RUN npm install 

# Copy the rest of the source code
COPY . .

# Expose the port your backend runs on
EXPOSE 4000

# Start the backend
CMD ["npm", "start"]