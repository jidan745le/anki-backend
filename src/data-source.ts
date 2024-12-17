import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';

dotenv.config({ path: 'src/.env' });

const isDevelopment = process.env.NODE_ENV === 'development';
console.log(process.env.NODE_ENV, isDevelopment, process.env.DB_HOST);

export const dataSource = new DataSource({
  type: 'mysql',
  host: isDevelopment ? 'localhost' : process.env.DB_HOST,
  port: isDevelopment ? 3306 : Number(process.env.DB_PORT),
  username: isDevelopment ? 'root' : process.env.DB_USERNAME,
  password: isDevelopment ? '123456' : process.env.DB_PASSWORD,
  database: isDevelopment ? 'anki' : process.env.DB_DATABASE,
  entities: ['src/user/entities/*.entity.ts', 'src/anki/entities/*.entity.ts'],
  poolSize: 10,
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  connectorPackage: 'mysql2',
  extra: {
    authPlugin: 'sha256_password',
  },
});
