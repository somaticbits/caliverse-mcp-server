import { createServer } from "node:http";
import { workoutCardsHtml } from "../src/ui/workout-cards.js";

const fixture = {
  workout: { id: 42, title: "Front Lever Foundations", level: "intermediate", length_in_minutes: 35 },
  cards: [
    { section: "main", superset: 1, superset_title: "Skill strength", rest_between_cycles: 90, position: 1, title: "Tuck front lever hold", set_count: 4, repetition_count: 12, repetition_type: "time", rest_time_before_exercise: 0, card_image_url: null, video_url: "https://www.youtube.com/", is_sided: false, equipment: ["Pull-up bar"], muscle_groups: ["Back"] },
    { section: "main", superset: 1, superset_title: "Skill strength", rest_between_cycles: 90, position: 2, title: "Bodyweight row", set_count: 4, repetition_count: 8, repetition_type: "count", rest_time_before_exercise: 60, card_image_url: null, video_url: "https://www.youtube.com/", is_sided: false, equipment: ["Low bar"], muscle_groups: ["Back"] }
  ]
};

const app = Buffer.from(workoutCardsHtml(), "utf8").toString("base64");
const page = `<!doctype html><html><head><meta charset="utf-8"><title>Workout card preview</title><style>body{margin:0;background:#e9ece9;font:14px system-ui,sans-serif}header{display:flex;gap:12px;align-items:center;padding:12px 20px;background:#17231d;color:#fff}button{border:0;border-radius:6px;padding:7px 10px;cursor:pointer}iframe{display:block;width:min(1200px,100%);height:calc(100vh - 50px);margin:auto;border:0;background:#fff}</style></head><body><header><strong>Caliverse MCP App preview</strong><button id="theme">Toggle host theme</button><span id="link">No ui/open-link request yet</span></header><iframe id="app"></iframe><script>const frame=document.getElementById('app');const data=${JSON.stringify(fixture)};let dark=false;let initialized=false;function notify(method,params){frame.contentWindow.postMessage({jsonrpc:'2.0',method,params},'*');}function reply(id,result){frame.contentWindow.postMessage({jsonrpc:'2.0',id,result},'*');}function deliverResult(){notify('ui/notifications/tool-input',{arguments:{workoutId:data.workout.id}});notify('ui/notifications/tool-result',{content:[{type:'text',text:'Preview'}],structuredContent:data});}document.getElementById('theme').onclick=()=>{dark=!dark;document.body.style.background=dark?'#050806':'#e9ece9';if(initialized)notify('ui/notifications/host-context-changed',{theme:dark?'dark':'light'});};window.addEventListener('message',event=>{const message=event.data;if(event.source!==frame.contentWindow||!message)return;if(message.method==='ui/initialize'){reply(message.id,{protocolVersion:'2026-01-26',hostCapabilities:{openLinks:{}},hostInfo:{name:'preview-host',version:'1.0.0'},hostContext:{theme:dark?'dark':'light',displayMode:'inline',availableDisplayModes:['inline']}});return;}if(message.method==='ui/notifications/initialized'){initialized=true;deliverResult();return;}if(message.method==='ui/open-link'){document.getElementById('link').textContent='ui/open-link -> '+message.params.url;reply(message.id,{});}});frame.srcdoc=new TextDecoder().decode(Uint8Array.from(atob('${app}'),character=>character.charCodeAt(0)));</script></body></html>`;

const server = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  response.end(page);
});
const port = Number(process.env.PORT ?? 0);
server.listen(Number.isSafeInteger(port) && port >= 0 && port <= 65_535 ? port : 0, "127.0.0.1", () => {
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Preview server did not bind a TCP port.");
  process.stderr.write(`Workout-card preview: http://127.0.0.1:${address.port}\n`);
});
