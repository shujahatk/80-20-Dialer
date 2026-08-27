import mongoose from 'mongoose';

let cached = global.mongoose;

if (!cached) {
  cached = global.mongoose = { conn: null, promise: null };
}

export async function connectDB() {
  const mongoUri = process.env.MONGODB_URI;

  if (!mongoUri || mongoUri.trim() === '') {
    console.log('[MongoDB] No MONGODB_URI provided. Falling back to local Zero-DB.');
    return false;
  }

  if (cached.conn) {
    return true;
  }

  if (!cached.promise) {
    const opts = {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    };

    cached.promise = mongoose.connect(mongoUri, opts).then((mongooseInstance) => {
      console.log(`[MongoDB] Connected: ${mongooseInstance.connection.host}/${mongooseInstance.connection.name}`);
      return mongooseInstance;
    }).catch(err => {
      console.error(`[MongoDB] Connection failed: ${err.message}`);
      cached.promise = null;
      return null;
    });
  }
  
  try {
    cached.conn = await cached.promise;
    return cached.conn !== null;
  } catch (err) {
    return false;
  }
}

export function isMongoConnected() {
  return mongoose.connection.readyState === 1;
}
