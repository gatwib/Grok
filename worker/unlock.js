export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors() });
    }
    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    const required = env.SEAL_TOKEN;
    if (required) {
      const auth = request.headers.get('Authorization') || '';
      const got = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!got || got !== required) {
        return json({ error: 'unauthorized' }, 401);
      }
    }

    const key = env.SEAL_KEY;
    if (!key) return json({ error: 'server_misconfigured' }, 500);

    const url = new URL(request.url);
    const kid = url.searchParams.get('kid') || 'default';
    return json({ v: 1, kid, key }, 200);
  },
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...cors(),
    },
  });
}
