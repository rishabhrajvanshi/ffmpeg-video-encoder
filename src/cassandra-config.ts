import { Client } from 'cassandra-driver';
import dotenv from 'dotenv';

dotenv.config();

// Cassandra configuration
const config = {
  contactPoints: ['localhost:9042'], // Replace with your Cassandra host
  localDataCenter: 'datacenter1', // Replace with your datacenter name
  keyspace: 'post_service', // Replace with your keyspace name
  credentials: {
    username: process.env.CASSANDRA_USERNAME || 'cassandra',
    password: process.env.CASSANDRA_PASSWORD || 'cassandra'
  }
};

// Create a new client
const cassandraClient = new Client(config);

// Initialize connection
async function initCassandra() {
  try {
    await cassandraClient.connect();
    console.log('Connected to Cassandra');

    // Create the sound table if it doesn't exist
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS sound (
        id uuid PRIMARY KEY,
        name text,
        user_id uuid,
        url text,
        thumbnail text
      )
    `;
    
    await cassandraClient.execute(createTableQuery);
    console.log('Sound table initialized');
  } catch (error) {
    console.error('Error connecting to Cassandra:', error);
    throw error;
  }
}

export { cassandraClient, initCassandra };
