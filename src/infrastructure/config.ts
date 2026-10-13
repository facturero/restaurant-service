import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // 3015: 3013 es inventory y 3014 assistant; ninguno más lo ocupa.
  PORT: z.coerce.number().int().positive().default(3015),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().min(1),
  RABBITMQ_URL: z.string().optional(),
  CORS_ORIGIN: z.string().default('*'),
  INTERNAL_USER_ID: z.string().default('00000000-0000-0000-0000-000000000000'),
  // Opcional: sirve para comprobar que el establecimiento existe antes de
  // inicializarlo. Si falta (desarrollo local), la comprobación se omite con
  // una advertencia en el log y el alta sigue adelante.
  ORG_SERVICE_URL: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`Configuración de entorno inválida:\n${issues}`);
  process.exit(1);
}

const env = parsed.data;

export interface AppConfig {
  NODE_ENV: 'development' | 'test' | 'production';
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_USER: string;
  DB_PASSWORD: string;
  DB_NAME: string;
  RABBITMQ_URL: string | undefined;
  CORS_ORIGIN: string;
  INTERNAL_USER_ID: string;
  ORG_SERVICE_URL: string | undefined;
}

export const config: AppConfig = {
  NODE_ENV: env.NODE_ENV,
  PORT: env.PORT,
  DB_HOST: env.DB_HOST,
  DB_PORT: env.DB_PORT,
  DB_USER: env.DB_USER,
  DB_PASSWORD: env.DB_PASSWORD,
  DB_NAME: env.DB_NAME,
  RABBITMQ_URL: env.RABBITMQ_URL,
  CORS_ORIGIN: env.CORS_ORIGIN,
  INTERNAL_USER_ID: env.INTERNAL_USER_ID,
  ORG_SERVICE_URL: env.ORG_SERVICE_URL,
};
