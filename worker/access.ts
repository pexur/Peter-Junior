// Sites supplies the signed-in user ID. Identity-less bearer requests may only
// reach the upload route, which verifies its own narrowly scoped secret.
export function checkSiteAccess(request: Request, ownerId?: string): Response | null {
  const path=new URL(request.url).pathname;
  if(path==="/api/shortcut-upload"&&request.method==="POST")return null;
  const user=request.headers.get("oai-authenticated-user-id");
  if(!user)return Response.json({error:"Sign in to Personal Daily to access your board."},{status:401,headers:{"Cache-Control":"no-store"}});
  if(ownerId&&user!==ownerId)return Response.json({error:"This board belongs to another account."},{status:403,headers:{"Cache-Control":"no-store"}});
  const origin=request.headers.get("origin");
  if(!["GET","HEAD","OPTIONS"].includes(request.method)&&origin&&origin!==new URL(request.url).origin)return Response.json({error:"Use Personal Daily to submit this change."},{status:403});
  return null;
}
