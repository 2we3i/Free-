import axios, { type AxiosInstance, type CreateAxiosDefaults } from 'axios';
import { logger } from '../core/logger.js';

export function createHttpClient(
  name: string,
  config: CreateAxiosDefaults = {},
): AxiosInstance {
  const client = axios.create({
    timeout: 60_000,
    ...config,
  });

  client.interceptors.request.use((request) => {
    logger.info(
      {
        service: name,
        method: request.method,
        url: request.url,
        baseURL: request.baseURL,
      },
      'http request',
    );
    return request;
  });

  client.interceptors.response.use(
    (response) => {
      logger.info(
        {
          service: name,
          status: response.status,
          url: response.config.url,
        },
        'http response',
      );
      return response;
    },
    (error: unknown) => {
      const axiosError = axios.isAxiosError(error) ? error : null;
      logger.error(
        {
          service: name,
          status: axiosError?.response?.status,
          url: axiosError?.config?.url,
          data: axiosError?.response?.data,
          err: error,
        },
        'http error',
      );
      return Promise.reject(error);
    },
  );

  return client;
}

export async function downloadBuffer(url: string): Promise<Buffer> {
  const response = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 180_000,
  });
  return Buffer.from(response.data);
}
