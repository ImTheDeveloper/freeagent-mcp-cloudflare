export function textResponse(text: string, status = 200): Response {
  return new Response(text, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function notImplementedResponse(message: string): Response {
  return textResponse(message, 501);
}

export function notFoundResponse(message = "Not found"): Response {
  return textResponse(message, 404);
}
