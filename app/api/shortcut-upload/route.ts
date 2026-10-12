import { handleShortcut } from "../../shortcut-server";
import { failure } from "../../voice-server";

export async function POST(request: Request) {
  try { return await handleShortcut(request); }
  catch(error) { const response=failure(error);response.headers.set("Cache-Control","no-store");return response; }
}
