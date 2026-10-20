export interface Env {
  DB: D1Database;
  API_TOKEN: string;
}

export default {
  async fetch(request: Request, _env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ok");
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
