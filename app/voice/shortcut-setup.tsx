"use client";
import { useI18n } from "../i18n/provider";
export default function ShortcutSetup(){
  const { tr } = useI18n();
  return <details className="voice-setup"><summary>{tr("Set up an iPhone Shortcut")}</summary>
    <p>{tr("Start by asking AI to generate a secure token for you, configure it on your website, and update your Shortcut setup instructions. You don’t need to handle the technical setup yourself.")}</p>
    <p>{tr("You can ask:")}</p>
    <blockquote>{tr("“Help me set up an iPhone Shortcut for Personal Daily. Generate a secure upload token, configure my website, and give me the connection details privately. Update my setup instructions, then walk me through the iPhone steps.”")}</blockquote>
    <p>{tr("Once that setup is complete, follow the detailed steps below using the website URL and connection values provided by AI.")}</p>
    <details><summary>{tr("Detailed iPhone setup steps")}</summary>
    <p>{tr("Record Audio → Save File → Upload → check the receipt. Always save the recording to Files before sending it, and keep that copy if anything fails.")}</p>
    <p>{tr("In every ")}<strong>{tr("Get Contents of URL")}</strong>{tr(" action, use the upload URL provided during setup, method ")}<strong>{tr("POST")}</strong>{tr(", and the connection headers provided by AI. Keep your connection values private.")}</p>
    <details><summary>{tr("1. Test the connection")}</summary><p>{tr("Set Request Body to JSON and add the text field below. The response should contain ")}<code>ready: true</code>.</p><pre>{JSON.stringify({action:"check"},null,2)}</pre></details>
    <details><summary>{tr("2. Upload recordings up to 10 MB")}</summary>
      <p>{tr("Record and save the audio. Generate a UUID once as Request ID and keep it for retries. Format the recording date as ")}<code>yyyy-MM-dd</code>{tr(" and use your timezone, such as ")}<code>Asia/Shanghai</code>.</p>
      <p>{tr("Base64 Encode the saved file with line breaks set to None. Use Match Text with ")}<code>{".{1,262144}"}</code>{tr(" to divide the encoded text into parts. The smaller parts are more reliable when iPhone Shortcuts sends JSON over a mobile connection. The audio itself is unchanged.")}</p>
      <p>{tr("Use Count on the matched Parts. Send this JSON first, replacing the examples with your variables. Set ")}<code>total_chunks</code>{tr(" as a Number using the Count result; the other fields are Text.")}</p>
      <pre>{JSON.stringify({action:"start",request_id:"Request ID",filename:"recording.m4a",content_type:"audio/mp4",total_chunks:4,local_date:"2026-09-10",timezone:"Asia/Shanghai"},null,2)}</pre>
      <p>{tr("Require ")}<code>upload_started: true</code>{tr(". Then use Repeat with Each on the matched parts. Inside it, send this JSON: ")}<code>part</code>{tr(" is the numeric Repeat Index (starting at 1), and ")}<code>data</code>{tr(" is the Repeat Item. Require ")}<code>uploaded: true</code>{tr(" before continuing.")}</p>
      <pre>{JSON.stringify({action:"chunk",request_id:"Request ID",part:1,data:"Repeat Item"},null,2)}</pre>
      <p>{tr("After the repeat, send:")}</p><pre>{JSON.stringify({action:"complete",request_id:"Request ID"},null,2)}</pre>
      <p>{tr("Only show “Transcript saved” if the response has ")}<code>transcript_saved: true</code>{tr(". Then open Voice Inbox to review the proposals. If completion times out, repeat the completion request with the same ID. If a part fails, retry that part or resend the file with the same ID and recording details. Do not delete the local audio.")}</p>
    </details>
    <details><summary>{tr("Alternative: one-request upload for files under 850 KB")}</summary>
      <p>{tr("Use Request Body: File, selecting the saved audio. Add ")}<code>X-Filename</code>, <code>X-Request-Id</code>, <code>X-Local-Date</code>{tr(", and ")}<code>X-Timezone</code>{tr(" headers. For M4A audio, set ")}<code>Content-Type: audio/mp4</code>{tr(". Larger files need the flow above because the hosting gateway limits each request.")}</p>
    </details>
    </details>
    <p>{tr("Need to change your connection later? Ask AI to replace the token and help you update your Shortcut.")}</p>
  </details>;
}
