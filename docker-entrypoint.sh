#!/bin/sh
set -e

echo "  🔄 Running database migrations..."
npx prisma migrate deploy --schema=server/db/prisma/schema.prisma

if [ "$SEED_ON_START" = "true" ]; then
  echo "  🌱 Seeding database..."
  node server/db/seed.js
fi

echo "  🚀 Starting LinguaChat..."
exec node server/index.js
