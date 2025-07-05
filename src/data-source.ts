import * as dotenv from 'dotenv';
import { DataSource } from 'typeorm';

const isDevelopment = process.env.NODE_ENV === 'development';
const envPath = isDevelopment ? 'src/.env' : '.env';
dotenv.config({ path: envPath });

console.log(process.env.NODE_ENV, isDevelopment, process.env.DB_HOST);

export const dataSource = new DataSource({
  type: 'mysql',
  host: isDevelopment ? 'localhost' : process.env.DB_HOST,
  port: isDevelopment ? 3306 : Number(process.env.DB_PORT),
  username: isDevelopment ? 'root' : process.env.DB_USERNAME,
  password: isDevelopment ? '123456' : process.env.DB_PASSWORD,
  database: isDevelopment ? 'anki' : process.env.DB_DATABASE,
  entities: isDevelopment
    ? [
        'src/user/entities/*.entity.ts',
        'src/anki/entities/*.entity.ts',
        'src/auth/entities/*',
        'src/aichat/entities/*',
      ]
    : [
        'user/entities/*.entity.js',
        'anki/entities/*.entity.js',
        'auth/entities/*.entity.js',
        'aichat/entities/*.entity.js',
      ],
  poolSize: 10,
  migrations: isDevelopment ? ['src/migrations/*.ts'] : ['migrations/*.js'],
  synchronize: false,
  connectorPackage: 'mysql2',
  extra: {
    authPlugin: 'sha256_password',
  },
});
