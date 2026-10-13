// Read-only authenticated interoperability check. Token is read from the process
// environment, never from argv, never printed, and never persisted.
const endpoint = process.env.AWCP_MCP_PUBLIC_URL;
const token = process.env.AWCP_MCP_ACCESS_TOKEN;
if (!endpoint || !token) throw new Error('Set AWCP_MCP_PUBLIC_URL and AWCP_MCP_ACCESS_TOKEN in the process environment.');
const url = new URL(endpoint);
if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) throw new Error('HTTPS or loopback HTTP required');
if (url.pathname !== '/mcp' || url.search || url.hash || url.username || url.password) throw new Error('Use the canonical MCP URL');
const probe = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
if (probe.status!==401) throw new Error(`Expected unauthenticated 401, got ${probe.status}`);
const metadataURL = new URL('/.well-known/oauth-protected-resource/mcp',url);
if (!(probe.headers.get('WWW-Authenticate')??'').includes(`resource_metadata="${metadataURL}"`)) throw new Error('Resource discovery challenge mismatch');
const metadataResponse = await fetch(metadataURL,{redirect:'error',signal:AbortSignal.timeout(10000)});
if (!metadataResponse.ok) throw new Error(`Metadata failed: ${metadataResponse.status}`);
const metadata = await metadataResponse.json();
if (metadata.resource!==endpoint || !Array.isArray(metadata.authorization_servers) || !metadata.authorization_servers.length) throw new Error('Invalid resource metadata');
let id=0;
async function rpc(method,params={}) {
  const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','Authorization':`Bearer ${token}`,'MCP-Protocol-Version':'2026-07-28','MCP-Method':method};
  if(params.name) headers['MCP-Name']=params.name;
  const _meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'awcp-readonly-smoke',version:'1.0.0'},'io.modelcontextprotocol/clientCapabilities':{}};
  const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++id,method,params:{...params,_meta}}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body=await response.json();
  if(body.error || body.result?.isError) throw new Error(`${method}: protocol/tool failure`);
  return body.result;
}
const listed=await rpc('tools/list');
if (!listed.tools?.some(tool=>tool.name==='context_get')) throw new Error('Context tool missing');
const context=await rpc('tools/call',{name:'context_get',arguments:{}});
const generation=context.structuredContent?.generation;
if(!generation) throw new Error('Missing workspace generation');
const report=await rpc('tools/call',{name:'analysis_query',arguments:{expectedGeneration:generation,filter:{pageSize:1,dataSource:"historical-fixtures"}}});
if(report.structuredContent?.dataSource!=='historical-fixtures' || report.structuredContent?.report?.items?.length!==1) throw new Error('Unexpected analysis result');
console.log(`PASS: OAuth discovery, ${listed.tools.length} authorized tools, bound workspace, read-only historical analysis. No business mutations executed.`);
