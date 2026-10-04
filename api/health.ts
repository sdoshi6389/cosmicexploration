import { IMAGE_MODEL, json, TEXT_MODEL, VOICE_MODEL } from './_lib/xai';

export function GET(): Response {
  return json({
    status: 'ok',
    xai_configured: Boolean(process.env.XAI_API_KEY),
    imagine_worker: Boolean(process.env.SPACETIME_WORKER_TOKEN),
    image_storage: process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'xai-url',
    models: { text: TEXT_MODEL, image: IMAGE_MODEL, voice: VOICE_MODEL },
    persistence: 'SpacetimeDB (authoritative, maincloud)',
  });
}
