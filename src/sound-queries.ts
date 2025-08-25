import { types } from 'cassandra-driver';
import { cassandraClient } from './cassandra-config';

interface Sound {
  name: string;
  user_id: types.Uuid;
  url: string;
  thumbnail: string;
}

export async function createSound(sound: Sound): Promise<types.Uuid> {
  const id = types.Uuid.random();
  const query = 'INSERT INTO sound (id, name, user_id, url, thumbnail) VALUES (:id, :name, :userId, :url, :thumbnail)';
  
  // Prepare parameters with proper type conversion and explicit typing
  const params = {
    id: id,
    name: sound.name,
    userId: sound.user_id.toString(),
    url: sound.url,
    thumbnail: sound.thumbnail
  };

  try {
    await cassandraClient.execute(query, params, { prepare: true });
    return id;
  } catch (error) {
    console.error('Error creating sound:', error);
    throw error;
  }
}
