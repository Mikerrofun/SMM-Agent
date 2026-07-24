export async function GET() {
  return Response.json({
    status: "ok",
    service: "smm-agent",
    timestamp: new Date().toISOString(),
  });
}
