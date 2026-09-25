import { NextResponse } from "next/server";
import { localVlmModels, modelAliases, modelId, modelOptions, providerLabel, scorerModels, vlmConfig } from "@/lib/server/vlm-config";
import { SCORER_WINDOW } from "@/lib/vlm/scorer";

export const dynamic = "force-dynamic";

// Which model the server will use. Never returns the key.
export function GET() {
  const vision = vlmConfig("vision");
  if (!vision) return NextResponse.json({ configured: false });
  const chat = vlmConfig("chat");
  const scorers = scorerModels();
  const localModels = [...localVlmModels(), ...scorers];
  return NextResponse.json({
    configured: true,
    model: modelId(vision),
    chatModel: chat ? modelId(chat) : undefined,
    provider: providerLabel(vision.baseUrl, vision.local),
    options: modelOptions(),
    // Real model -> display name, so recordings saved under the real name show the alias too
    aliases: Object.fromEntries([...modelAliases()].map(([alias, real]) => [real, alias])),
    scorers,
    scorerWindow: scorers.length ? SCORER_WINDOW : undefined,
    localModels,
    localProvider: localModels.length ? providerLabel("", true) : undefined,
  });
}
