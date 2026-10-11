import { EdgeTTS } from "@travisvn/edge-tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const voices = new Set(["pl-PL-ZofiaNeural", "pl-PL-MarekNeural"]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { text?: unknown; voice?: unknown };
    const text = typeof body.text === "string" ? body.text.trim().slice(0, 1400) : "";
    if (!text) return Response.json({ error: "Brak tekstu do odczytania." }, { status: 400 });
    const voice = typeof body.voice === "string" && voices.has(body.voice) ? body.voice : "pl-PL-ZofiaNeural";
    const result = await new EdgeTTS(text, voice).synthesize();
    const audio = Buffer.from(await result.audio.arrayBuffer());
    return new Response(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": String(audio.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Edge TTS synthesis failed", error);
    return Response.json({ error: "Synteza mowy jest chwilowo niedostępna." }, { status: 503 });
  }
}
