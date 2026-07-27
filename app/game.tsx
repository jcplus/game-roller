"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

type Hud = { score: number; people: number; combo: number; size: number; time: number; destroyed: number };
type Target = { mesh: THREE.Object3D; radius: number; baseRadius?: number; height?: number; value: number; kind: "person" | "fragment" | "car" | "tree" | "building"; minSize: number; alive: boolean };
type Pedestrian = {
  target: Target;
  body: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  alert: THREE.Sprite;
  state: "idle" | "walk" | "alert" | "run";
  direction: THREE.Vector3;
  stateUntil: number;
  gait: number;
  homeAxis: "x" | "z";
};

const palette = {
  asphalt: 0x31343a, concrete: 0x8a8b82, grass: 0x465a40, cream: 0xd4c7a4,
  brick: 0x7d4038, blue: 0x607c86, dark: 0x21242a, red: 0xaa3b30, yellow: 0xf1be3b,
};

function seeded(seed = 207906) {
  let s = seed >>> 0;
  return () => ((s = Math.imul(1664525, s) + 1013904223 >>> 0) / 4294967296);
}

export default function Game() {
  const mount = useRef<HTMLDivElement>(null);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [hud, setHud] = useState<Hud>({ score: 0, people: 0, combo: 1, size: 1, time: 90, destroyed: 0 });
  const gameRef = useRef({ start: () => {}, restart: () => {} });
  const performanceRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mount.current) return;
    const host = mount.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x7d8b83);
    scene.fog = new THREE.FogExp2(0x73807b, 0.0045);
    const camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 600);
    camera.position.set(42, 56, 42);
    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    renderer.setSize(host.clientWidth, host.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Preserve counters across the world and GPU post-processing passes. They
    // are reset explicitly once per frame below.
    renderer.info.autoReset = false;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.cursor = "grab";
    const drawingSize=new THREE.Vector2();renderer.getDrawingBufferSize(drawingSize);
    const renderTarget=new THREE.WebGLRenderTarget(drawingSize.x,drawingSize.y,{minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,depthBuffer:true});
    const postScene=new THREE.Scene(),postCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
    const postMaterial=new THREE.ShaderMaterial({
      uniforms:{tDiffuse:{value:renderTarget.texture},resolution:{value:drawingSize.clone()}},
      vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
      fragmentShader:`
        uniform sampler2D tDiffuse;uniform vec2 resolution;varying vec2 vUv;
        float noise(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}
        void main(){
          // Deliberately coarse, unstable sampling recreates a late-90s console framebuffer.
          vec2 virtualResolution=vec2(568.0,320.0);
          vec2 snappedUv=(floor(vUv*virtualResolution)+.5)/virtualResolution;
          float row=floor(snappedUv.y*virtualResolution.y);
          snappedUv.x+=(noise(vec2(row,floor(row/3.0)))-.5)/resolution.x*.38;
          vec2 px=1.0/virtualResolution;
          vec3 base;
          base.r=texture2D(tDiffuse,snappedUv+vec2(px.x*.17,0.0)).r;
          base.g=texture2D(tDiffuse,snappedUv).g;
          base.b=texture2D(tDiffuse,snappedUv-vec2(px.x*.15,0.0)).b;
          vec3 neighbors=(texture2D(tDiffuse,snappedUv+vec2(px.x,0.0)).rgb+
            texture2D(tDiffuse,snappedUv-vec2(px.x,0.0)).rgb+
            texture2D(tDiffuse,snappedUv+vec2(0.0,px.y)).rgb+
            texture2D(tDiffuse,snappedUv-vec2(0.0,px.y)).rgb)*.25;
          vec3 c=base+(base-neighbors)*.14;
          c=pow(max(c,vec3(0.0)),vec3(.62));
          c=(c-.5)*1.04+.59;
          float l=dot(c,vec3(.299,.587,.114));c=mix(vec3(l),c,1.08);
          c.b*=.94;c.g*=.98;
          float dither=mod(floor(gl_FragCoord.x/2.0)+floor(gl_FragCoord.y/2.0)*2.0,4.0)/4.0-.375;
          c=floor(clamp(c+dither/30.0,0.0,1.0)*22.0+.5)/22.0;
          c+=((noise(floor(gl_FragCoord.xy/2.0))-.5)/68.0);
          c*=.982+.018*mod(floor(gl_FragCoord.y),2.0);
          gl_FragColor=vec4(c,1.0);
        }`,
      depthTest:false,depthWrite:false,toneMapped:false,
    });
    postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),postMaterial));

    const hemi=new THREE.HemisphereLight(0xd8e0d7, 0x3f4840, 2.8);scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffedcf, 3.7);
    sun.position.set(-50, 75, 35); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); sun.shadow.camera.left = sun.shadow.camera.bottom = -95; sun.shadow.camera.right = sun.shadow.camera.top = 95;
    // Prevent large ground triangles from self-shadowing differently across their diagonal.
    sun.shadow.bias=-0.00035;sun.shadow.normalBias=.065;sun.shadow.radius=1;
    scene.add(sun);

    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const cylGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
    const sphereGeo = new THREE.IcosahedronGeometry(1, 2);
    const mats = new Map<number, THREE.MeshStandardMaterial>();
    const mat = (c: number, rough = .85) => { if (!mats.has(c)) mats.set(c, new THREE.MeshStandardMaterial({ color: c, roughness: rough })); return mats.get(c)!; };
    const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number, group = scene) => {
      const m = new THREE.Mesh(boxGeo, mat(c)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = sy > .5; m.receiveShadow = true; group.add(m); return m;
    };

    // Full-resolution, mottled olive grass inspired by the reference without lowering render resolution.
    const grassCanvas=document.createElement("canvas");grassCanvas.width=grassCanvas.height=256;
    const grassContext=grassCanvas.getContext("2d")!;
    grassContext.fillStyle="#4a503b";grassContext.fillRect(0,0,256,256);
    const grassRandom=seeded(77331);
    for(let i=0;i<6200;i++){
      const light=Math.floor(38+grassRandom()*42), green=Math.floor(43+grassRandom()*40);
      grassContext.fillStyle=`rgba(${light},${green},${Math.floor(31+grassRandom()*28)},${.16+grassRandom()*.34})`;
      const x=grassRandom()*256,y=grassRandom()*256,w=.6+grassRandom()*2.8,h=.4+grassRandom()*1.5;
      grassContext.fillRect(x,y,w,h);
    }
    for(let i=0;i<75;i++){
      const x=grassRandom()*256,y=grassRandom()*256,r=3+grassRandom()*13;
      const patch=grassContext.createRadialGradient(x,y,0,x,y,r);
      patch.addColorStop(0,grassRandom()>.5?"rgba(20,24,17,.22)":"rgba(121,112,76,.16)");
      patch.addColorStop(1,"rgba(0,0,0,0)");
      grassContext.fillStyle=patch;grassContext.fillRect(x-r,y-r,r*2,r*2);
    }
    const grassTexture=new THREE.CanvasTexture(grassCanvas);
    grassTexture.wrapS=grassTexture.wrapT=THREE.RepeatWrapping;grassTexture.repeat.set(14,14);
    grassTexture.colorSpace=THREE.SRGBColorSpace;grassTexture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    const grassMaterial=new THREE.MeshStandardMaterial({map:grassTexture,color:0x9aa082,roughness:1});
    // Blue-green, worn road surface and softly weathered paint sampled from the reference.
    const roadCanvas=document.createElement("canvas");roadCanvas.width=roadCanvas.height=256;
    const roadContext=roadCanvas.getContext("2d")!,roadRandom=seeded(48126);
    roadContext.fillStyle="#17656f";roadContext.fillRect(0,0,256,256);
    for(let i=0;i<9000;i++){
      const tone=roadRandom();
      roadContext.fillStyle=tone>.72?`rgba(89,145,148,${.025+roadRandom()*.09})`:tone<.22?`rgba(4,38,45,${.03+roadRandom()*.1})`:`rgba(31,105,112,${.03+roadRandom()*.08})`;
      const size=.4+roadRandom()*2.2;roadContext.fillRect(roadRandom()*256,roadRandom()*256,size,size);
    }
    for(let i=0;i<34;i++){
      roadContext.strokeStyle=`rgba(7,45,50,${.035+roadRandom()*.06})`;roadContext.lineWidth=.4+roadRandom()*1.1;
      roadContext.beginPath();let x=roadRandom()*256,y=roadRandom()*256;roadContext.moveTo(x,y);
      for(let j=0;j<4;j++){x+=(roadRandom()-.5)*28;y+=(roadRandom()-.5)*14;roadContext.lineTo(x,y);}roadContext.stroke();
    }
    const roadTexture=new THREE.CanvasTexture(roadCanvas);roadTexture.wrapS=roadTexture.wrapT=THREE.RepeatWrapping;roadTexture.repeat.set(18,18);
    roadTexture.colorSpace=THREE.SRGBColorSpace;roadTexture.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());
    const roadMaterial=new THREE.MeshStandardMaterial({map:roadTexture,color:0x87aeb0,roughness:.98,metalness:0});
    const paintMaterial=(base:string,light:string)=>{
      const canvas=document.createElement("canvas");canvas.width=canvas.height=64;const context=canvas.getContext("2d")!,random=seeded(base==="#eee9d5"?7211:7212);
      context.fillStyle=base;context.fillRect(0,0,64,64);
      for(let i=0;i<260;i++){context.fillStyle=random()>.58?`${light}${Math.floor((.05+random()*.18)*255).toString(16).padStart(2,"0")}`:`#253f43${Math.floor((.03+random()*.13)*255).toString(16).padStart(2,"0")}`;context.fillRect(random()*64,random()*64,.5+random()*2.5,.5+random()*1.4);}
      const texture=new THREE.CanvasTexture(canvas);texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(5,2);texture.colorSpace=THREE.SRGBColorSpace;
      return new THREE.MeshStandardMaterial({map:texture,color:0xffffff,roughness:1});
    };
    const whiteRoadMaterial=paintMaterial("#eee9d5","#ffffff");
    const yellowRoadMaterial=paintMaterial("#c8ad54","#f3d97a");
    const surfaceBox=(x:number,y:number,z:number,sx:number,sy:number,sz:number,material:THREE.Material,group=scene)=>{
      const mesh=new THREE.Mesh(boxGeo,material);mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.receiveShadow=true;group.add(mesh);return mesh;
    };
    const meatCanvas=document.createElement("canvas");meatCanvas.width=meatCanvas.height=64;
    const meatContext=meatCanvas.getContext("2d")!,meatRandom=seeded(99173);
    meatContext.fillStyle="#7b2825";meatContext.fillRect(0,0,64,64);
    // Deliberately blocky fat, dried blood and fibrous highlights.
    for(let i=0;i<240;i++){
      const tone=meatRandom();
      meatContext.fillStyle=tone>.76?"rgba(202,105,80,.7)":tone<.28?"rgba(48,3,9,.78)":"rgba(126,24,29,.55)";
      const x=Math.floor(meatRandom()*32)*2,y=Math.floor(meatRandom()*32)*2,w=1+Math.floor(meatRandom()*4),h=1+Math.floor(meatRandom()*3);
      meatContext.fillRect(x,y,w,h);
    }
    meatContext.lineWidth=1;
    for(let i=0;i<20;i++){
      meatContext.strokeStyle=i%3===0?"rgba(181,78,62,.8)":"rgba(67,7,15,.72)";
      meatContext.beginPath();let x=meatRandom()*64,y=meatRandom()*64;meatContext.moveTo(x,y);
      for(let j=0;j<5;j++){x+=3+meatRandom()*7;y+=(meatRandom()-.5)*7;meatContext.lineTo(Math.round(x),Math.round(y));}
      meatContext.stroke();
    }
    const meatTexture=new THREE.CanvasTexture(meatCanvas);
    // Keep texels large enough to read from the isometric camera instead of shrinking into a flat average color.
    meatTexture.wrapS=meatTexture.wrapT=THREE.RepeatWrapping;meatTexture.repeat.set(.42,.42);
    meatTexture.magFilter=THREE.NearestFilter;meatTexture.minFilter=THREE.NearestFilter;meatTexture.generateMipmaps=false;
    meatTexture.colorSpace=THREE.SRGBColorSpace;
    const ground=new THREE.Mesh(boxGeo,grassMaterial);ground.position.set(0,-.55,0);ground.scale.set(170,1,170);ground.receiveShadow=true;scene.add(ground);
    const roadGroup = new THREE.Group(); scene.add(roadGroup);
    // The network deliberately mixes a narrow two-lane street, a four-lane arterial
    // and an asymmetric avenue. It keeps the readable grid while avoiding nine
    // identical corridors.
    const verticalRoads=[
      {at:-54,width:14,laneOffsets:[-4.35,4.35]},
      {at:0,width:22,laneOffsets:[-4.1,-7.8,4.1,7.8]},
      {at:54,width:18,laneOffsets:[-6.1,6.1]},
    ];
    const horizontalRoads=[
      {at:-54,width:22,laneOffsets:[-4.1,-7.8,4.1,7.8]},
      {at:0,width:14,laneOffsets:[-4.35,4.35]},
      {at:54,width:18,laneOffsets:[-6.1,6.1]},
    ];
    const outsideIntersections=(position:number,crossings:{at:number;width:number}[])=>
      crossings.every(crossing=>Math.abs(position-crossing.at)>crossing.width/2+3.2);
    for(const road of verticalRoads){
      surfaceBox(road.at,.02,0,road.width,.12,170,roadMaterial,roadGroup);
      // Markings terminate before every junction; nothing is painted through the
      // crossing box. This also leaves a clean vehicle turning area.
      for(let p=-82;p<=82;p+=2){
        if(!outsideIntersections(p,horizontalRoads))continue;
        surfaceBox(road.at-1.05,.105,p,.23,.035,2.05,yellowRoadMaterial,roadGroup);
        surfaceBox(road.at+1.05,.105,p,.23,.035,2.05,yellowRoadMaterial,roadGroup);
      }
      for(let p=-78;p<=78;p+=9){
        if(!outsideIntersections(p,horizontalRoads))continue;
        for(const offset of road.laneOffsets)
          surfaceBox(road.at+offset,.11,p,.18,.035,4.2,whiteRoadMaterial,roadGroup);
      }
    }
    for(const road of horizontalRoads){
      surfaceBox(0,.025,road.at,170,.12,road.width,roadMaterial,roadGroup);
      for(let p=-82;p<=82;p+=2){
        if(!outsideIntersections(p,verticalRoads))continue;
        surfaceBox(p,.11,road.at-1.05,2.05,.035,.23,yellowRoadMaterial,roadGroup);
        surfaceBox(p,.11,road.at+1.05,2.05,.035,.23,yellowRoadMaterial,roadGroup);
      }
      for(let p=-78;p<=78;p+=9){
        if(!outsideIntersections(p,verticalRoads))continue;
        for(const offset of road.laneOffsets)
          surfaceBox(p,.115,road.at+offset,4.2,.035,.18,whiteRoadMaterial,roadGroup);
      }
    }
    // Crosswalk setbacks follow the width of each approach rather than forming a
    // repeated checkerboard.
    verticalRoads.forEach(v => horizontalRoads.forEach(h => {
      if(v.at===0&&h.at===0)return;
      const xStep=Math.max(1.25,v.width/13),zStep=Math.max(1.25,h.width/13);
      for (let i=-4; i<=4; i++) {
        // Zebra crossings occupy all four approaches and remain perpendicular
        // to traffic, as in the reference.
        surfaceBox(v.at+i*xStep,.12,h.at-h.width/2-1.3,.75,.035,3.5,whiteRoadMaterial,roadGroup);
        surfaceBox(v.at+i*xStep,.12,h.at+h.width/2+1.3,.75,.035,3.5,whiteRoadMaterial,roadGroup);
        surfaceBox(v.at-v.width/2-1.3,.12,h.at+i*zStep,3.5,.035,.75,whiteRoadMaterial,roadGroup);
        surfaceBox(v.at+v.width/2+1.3,.12,h.at+i*zStep,3.5,.035,.75,whiteRoadMaterial,roadGroup);
      }
    }));
    // A landscaped roundabout makes the civic centre a distinct navigational
    // landmark and introduces curved road language into the otherwise rectilinear city.
    const roundaboutRoad=new THREE.Mesh(new THREE.CylinderGeometry(10.6,10.6,.14,40),roadMaterial);
    roundaboutRoad.position.set(0,.105,0);roundaboutRoad.receiveShadow=true;roadGroup.add(roundaboutRoad);
    const roundaboutIsland=new THREE.Mesh(new THREE.CylinderGeometry(4.2,4.55,.42,24),grassMaterial);
    roundaboutIsland.position.set(0,.34,0);roundaboutIsland.receiveShadow=true;roadGroup.add(roundaboutIsland);
    const roundaboutCurb=new THREE.Mesh(new THREE.TorusGeometry(4.55,.23,6,40),mat(0xe6e1cd));
    roundaboutCurb.rotation.x=Math.PI/2;roundaboutCurb.position.y=.57;roadGroup.add(roundaboutCurb);
    const roundaboutLine=new THREE.Mesh(new THREE.TorusGeometry(7.25,.11,5,48),yellowRoadMaterial);
    roundaboutLine.rotation.x=Math.PI/2;roundaboutLine.position.y=.2;roadGroup.add(roundaboutLine);
    // The roundabout has one controlled crossing on each approach, outside the
    // circulating lane instead of stripes cutting across the island.
    for(let i=-4;i<=4;i++){
      surfaceBox(i*1.45,.215,-12.4,.78,.035,3.2,whiteRoadMaterial,roadGroup);
      surfaceBox(i*1.45,.215,12.4,.78,.035,3.2,whiteRoadMaterial,roadGroup);
      surfaceBox(-12.4,.215,i*1.45,3.2,.035,.78,whiteRoadMaterial,roadGroup);
      surfaceBox(12.4,.215,i*1.45,3.2,.035,.78,whiteRoadMaterial,roadGroup);
    }

    // Random rain fronts: bright falling streaks plus animated road puddles that
    // accumulate in rain and evaporate slowly after the weather clears.
    const weatherRandom=seeded(93210),rainCount=360,rainPositions=new Float32Array(rainCount*6);
    for(let i=0;i<rainCount;i++){
      const n=i*6,x=(weatherRandom()-.5)*110,y=4+weatherRandom()*54,z=(weatherRandom()-.5)*110,length=.7+weatherRandom()*2.2;
      rainPositions[n]=x;rainPositions[n+1]=y;rainPositions[n+2]=z;rainPositions[n+3]=x-.18;rainPositions[n+4]=y-length;rainPositions[n+5]=z+.08;
    }
    const rainGeometry=new THREE.BufferGeometry();rainGeometry.setAttribute("position",new THREE.BufferAttribute(rainPositions,3));
    const rainMaterial=new THREE.LineBasicMaterial({color:0xdce9de,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
    const rain=new THREE.LineSegments(rainGeometry,rainMaterial);rain.frustumCulled=false;scene.add(rain);
    // Local wet decals work like the blood decals: transparent irregular patches
    // darken only the covered asphalt instead of turning the whole road metallic.
    const wetPatchMaterials:THREE.MeshStandardMaterial[]=[];
    // Several independently generated masks avoid the repeated "decal stamp" look.
    for(let variant=0;variant<5;variant++){
      const wetCanvas=document.createElement("canvas");wetCanvas.width=wetCanvas.height=128;const wetContext=wetCanvas.getContext("2d")!;
      for(let i=0;i<14+variant;i++){
        const cx=18+weatherRandom()*92,cy=20+weatherRandom()*88,rx=8+weatherRandom()*35,ry=3+weatherRandom()*17;
        const gradient=wetContext.createRadialGradient(cx,cy,0,cx,cy,Math.max(rx,ry));
        gradient.addColorStop(0,"rgba(25,64,68,.9)");gradient.addColorStop(.58,"rgba(38,78,81,.65)");gradient.addColorStop(1,"rgba(48,85,87,0)");
        wetContext.save();wetContext.translate(cx,cy);wetContext.rotate((weatherRandom()-.5)*.65);wetContext.scale(rx/Math.max(rx,ry),ry/Math.max(rx,ry));wetContext.translate(-cx,-cy);
        wetContext.fillStyle=gradient;wetContext.fillRect(cx-Math.max(rx,ry),cy-Math.max(rx,ry),Math.max(rx,ry)*2,Math.max(rx,ry)*2);wetContext.restore();
      }
      // Thin runoff fingers and small satellite pools break up every shoreline.
      wetContext.lineCap="round";
      for(let i=0;i<24;i++){
        wetContext.strokeStyle=`rgba(30,70,74,${.1+weatherRandom()*.3})`;wetContext.lineWidth=.5+weatherRandom()*3;
        wetContext.beginPath();const x=weatherRandom()*128,y=weatherRandom()*128;wetContext.moveTo(x,y);
        wetContext.quadraticCurveTo(x+(weatherRandom()-.5)*35,y+(weatherRandom()-.5)*12,x+(weatherRandom()-.5)*60,y+(weatherRandom()-.5)*22);wetContext.stroke();
      }
      for(let i=0;i<110;i++){wetContext.fillStyle=`rgba(28,68,71,${.08+weatherRandom()*.28})`;wetContext.fillRect(weatherRandom()*128,weatherRandom()*128,.5+weatherRandom()*4,.5+weatherRandom()*2);}
      const wetTexture=new THREE.CanvasTexture(wetCanvas);wetTexture.colorSpace=THREE.SRGBColorSpace;wetTexture.magFilter=THREE.LinearFilter;
      wetPatchMaterials.push(new THREE.MeshStandardMaterial({map:wetTexture,transparent:true,opacity:.26,depthWrite:false,roughness:.7,metalness:0,color:0x5d8588,polygonOffset:true,polygonOffsetFactor:-1}));
    }
    // Dense puddle fields: broad pools collect near lane edges, while smaller
    // irregular remnants are scattered through tyre tracks and intersections.
    for(let i=0;i<145;i++){
      const vertical=weatherRandom()>.5,lane=[-54,0,54][Math.floor(weatherRandom()*3)],along=-82+weatherRandom()*164;
      const edgeBiased=weatherRandom()>.38,across=edgeBiased?(weatherRandom()>.5?1:-1)*(5.2+weatherRandom()*2.2):(weatherRandom()-.5)*9.5;
      const broad=i<48,width=broad?7+weatherRandom()*11:1.8+weatherRandom()*6,height=broad?3+weatherRandom()*6:.8+weatherRandom()*3.2;
      const patch=new THREE.Mesh(new THREE.PlaneGeometry(width,height),wetPatchMaterials[i%wetPatchMaterials.length]);
      patch.rotation.x=-Math.PI/2;patch.rotation.z=(vertical?0:Math.PI/2)+(weatherRandom()-.5)*(broad?.42:1.35);
      patch.position.set(vertical?lane+across:along,.143+(i%5)*.0004,vertical?along:lane+across);scene.add(patch);
    }
    let raining=true,rainStrength=0,roadWetness=.42,weatherChangeAt=performance.now()+9000+weatherRandom()*9000;
    const dryRoadColor=new THREE.Color(0x87aeb0),wetRoadColor=new THREE.Color(0x496f74);
    const morningSky=new THREE.Color(0x788b86),noonSky=new THREE.Color(0x91aaa5),eveningSky=new THREE.Color(0x6f625c);
    const morningSun=new THREE.Color(0xffc78c),noonSun=new THREE.Color(0xfff2d2),eveningSun=new THREE.Color(0xff8b58);
    const morningHemi=new THREE.Color(0xc5d2c9),noonHemi=new THREE.Color(0xe2ebe2),eveningHemi=new THREE.Color(0xb18f82);
    const nightSky=new THREE.Color(0x263743),nightSun=new THREE.Color(0x8794a2),nightHemi=new THREE.Color(0x526776);
    const phaseSky=new THREE.Color(),phaseSun=new THREE.Color(),phaseHemi=new THREE.Color();

    // Covered pedestrian bridges based on the reference: oxidized blue steel,
    // pale corrugated roofing, long stepped approaches, and open side trusses.
    const roofCanvas=document.createElement("canvas");roofCanvas.width=128;roofCanvas.height=64;const roofContext=roofCanvas.getContext("2d")!;
    roofContext.fillStyle="#b9aa85";roofContext.fillRect(0,0,128,64);
    for(let x=0;x<128;x+=6){roofContext.fillStyle=x%12===0?"#d0c39e":"#8f8468";roofContext.fillRect(x,0,2,64);}
    const roofWear=seeded(64321);for(let i=0;i<240;i++){roofContext.fillStyle=roofWear()>.55?"rgba(72,61,45,.16)":"rgba(235,220,175,.14)";roofContext.fillRect(roofWear()*128,roofWear()*64,1+roofWear()*5,1+roofWear()*2);}
    const roofTexture=new THREE.CanvasTexture(roofCanvas);roofTexture.wrapS=roofTexture.wrapT=THREE.RepeatWrapping;roofTexture.repeat.set(5,2);roofTexture.colorSpace=THREE.SRGBColorSpace;
    const bridgeRoofMaterial=new THREE.MeshStandardMaterial({map:roofTexture,color:0xd0c5a4,roughness:.95});
    const addFootbridge=(x:number,z:number,rotation:number)=>{
      const bridge=new THREE.Group();bridge.position.set(x,0,z);bridge.rotation.y=rotation;scene.add(bridge);
      const steel=0x446b70,steelDark=0x294b52,floor=0x728b86;
      // Main enclosed span, high enough for all traffic.
      box(0,6.05,0,35,.55,4.4,floor,bridge);
      box(0,6.45,-2.08,35,.22,.24,steelDark,bridge);box(0,6.45,2.08,35,.22,.24,steelDark,bridge);
      for(const side of [-1,1]){
        box(0,8.15,side*2.08,35,.18,.22,steel,bridge);
        for(let px=-16;px<=16;px+=2){
          box(px,7.3,side*2.08,.16,2.05,.2,steel,bridge);
          const brace=box(px+.48,7.28,side*2.09,.11,2.25,.16,steelDark,bridge);brace.rotation.z=(px/2)%2===0?.48:-.48;
        }
      }
      // Two slightly pitched corrugated roof sheets and raised ridge cap.
      const roofA=surfaceBox(0,8.75,-1.18,35.8,.18,2.7,bridgeRoofMaterial,bridge);roofA.rotation.x=-.13;
      const roofB=surfaceBox(0,8.75,1.18,35.8,.18,2.7,bridgeRoofMaterial,bridge);roofB.rotation.x=.13;
      surfaceBox(0,9.02,0,36,.18,.28,bridgeRoofMaterial,bridge);
      // Four steel trestles with cross bracing and concrete feet.
      for(const px of [-13,-9,9,13]){
        for(const side of [-1,1]){
          box(px,3.1,side*1.72,.42,5.8,.42,steelDark,bridge);
          box(px,.3,side*1.72,1.05,.5,1.05,0x777b73,bridge);
        }
        const cross=box(px,3.6,0,.2,4.3,3.65,steel,bridge);cross.rotation.x=Math.PI/4;
      }
      // Long staircases continue from both ends; individual treads make the
      // striped stepped texture visible from the isometric camera.
      const steps=14;
      for(const end of [-1,1])for(let i=0;i<steps;i++){
        const t=i/(steps-1),height=.35+(1-t)*5.45,px=end*(18+i*.72);
        box(px,height*.5,0,1.25,height,4.25,steel,bridge);
        box(px,height+.08,0,1.28,.16,4.18,0xa59d83,bridge);
        for(const side of [-1,1]){
          box(px,height+.62,side*2.03,1.22,.12,.15,steelDark,bridge);
          box(px,height+.3,side*2.03,.14,.9,.14,steelDark,bridge);
        }
      }
      for(const end of [-1,1])box(end*28.1,.22,0,3.1,.28,5.3,0x787c74,bridge);
      // Small warm lamps below the canopy.
      for(let px=-14;px<=14;px+=7){
        const lampMat=new THREE.MeshStandardMaterial({color:0xf3c56a,emissive:0xf0a72d,emissiveIntensity:1.4,roughness:.35});
        const lamp=new THREE.Mesh(sphereGeo,lampMat);lamp.position.set(px,8.25,0);lamp.scale.setScalar(.16);bridge.add(lamp);
      }
    };
    addFootbridge(-54,14,0);
    addFootbridge(14,54,Math.PI/2);

    const targets: Target[] = [];
    const buildings: THREE.Object3D[] = [];
    const plannedTreePositions:{x:number;z:number}[]=[];
    const rng = seeded();
    const blocks = [-27, 27];
    const stone=[0x777a72,0x8d897c,0x656b68],trim=0xb5ad97,windowDark=0x273235,windowGlow=0xc9a75d,roofDark=0x30383a;
    const addReferenceBuilding=(g:THREE.Group,w:number,h:number,d:number,style:number)=>{
      const detail=(geometry:THREE.BufferGeometry,c:number,x:number,y:number,z:number,rx=0,ry=0,rz=0)=>{
        const m=new THREE.Mesh(geometry,mat(c));m.position.set(x,y,z);m.rotation.set(rx,ry,rz);m.castShadow=m.receiveShadow=true;g.add(m);return m;
      };
      const column=(x:number,y:number,z:number,height:number,c=trim,r=.18)=>{
        const shaft=detail(new THREE.CylinderGeometry(r,r*1.08,height,8),c,x,y,z);
        detail(new THREE.CylinderGeometry(r*1.45,r*1.45,.18,8),c,x,y-height*.5+.09,z);
        detail(new THREE.CylinderGeometry(r*1.35,r*1.5,.22,8),c,x,y+height*.5-.11,z);return shaft;
      };
      const frontWindow=(x:number,y:number,width:number,height:number,z=d*.5+.16,c=windowGlow)=>{
        box(x,y,z,width,height,.12,c,g);
        box(x,y,z+.07,.08,height+.08,.06,trim,g);
        box(x,y,z+.07,width+.08,.08,.06,trim,g);
        // Pointed stone hood gives even tiny windows a readable gothic silhouette.
        const hood=detail(new THREE.ConeGeometry(width*.62,width*.48,3),trim,x,y+height*.58,z+.06,Math.PI/2,0,Math.PI);
        hood.scale.z=.22;
      };
      // The reference uses three strong silhouettes: a buttressed neo-gothic hall,
      // a narrow art-deco shopfront, and a pale curved-corner civic block.
      if(style===0){
        box(0,h*.48,0,w,h*.96,d,stone[0],g);
        box(0,h*.93,0,w+.7,.7,d+.7,roofDark,g);
        for(const y of [h*.22,h*.47,h*.72,h*.91]){
          box(0,y,d*.505,w+.22,.16,.2,trim,g);box(0,y,-d*.505,w+.22,.16,.2,trim,g);
          box(w*.505,y,0,.2,.16,d+.22,trim,g);box(-w*.505,y,0,.2,.16,d+.22,trim,g);
        }
        // Raised central nave and four crenellated corner towers.
        box(0,h+.65,0,w*.42,2.1,d*.72,stone[1],g);
        const naveRoof=detail(new THREE.ConeGeometry(Math.max(w*.3,d*.26),2.7,4),roofDark,0,h+2.65,0,0,Math.PI/4,0);
        naveRoof.scale.z=Math.max(.55,d/w);
        for(const sx of [-1,1])for(const sz of [-1,1]){
          box(sx*(w*.5-.65),h*.58,sz*(d*.5-.65),1.35,h*1.16,1.35,stone[2],g);
          box(sx*(w*.5-.65),h*1.2,sz*(d*.5-.65),1.75,.48,1.75,trim,g);
          for(const ox of [-.62,.62]){
            box(sx*(w*.5-.65)+ox,h*1.28,sz*(d*.5-.65),.35,.55,1.75,stone[2],g);
            box(sx*(w*.5-.65),h*1.28,sz*(d*.5-.65)+ox,1.75,.55,.35,stone[2],g);
          }
          box(sx*(w*.5-.65),h*.6,sz*(d*.5+.025),.28,h*.5,.11,windowDark,g);
          const spire=detail(new THREE.ConeGeometry(.72,1.7,4),roofDark,sx*(w*.5-.65),h*1.43,sz*(d*.5-.65),0,Math.PI/4,0);
          spire.scale.y=.78;
        }
        // Small roofline merlons remain legible at the game's isometric distance.
        for(let x=-w*.4;x<=w*.4;x+=1.35){
          box(x,h*1.005,d*.5+.12,.48,.55,.42,stone[2],g);
          box(x,h*1.005,-d*.5-.12,.48,.55,.42,stone[2],g);
        }
        for(let z=-d*.35;z<=d*.35;z+=1.35){
          box(w*.5+.12,h*1.005,z,.42,.55,.48,stone[2],g);
          box(-w*.5-.12,h*1.005,z,.42,.55,.48,stone[2],g);
        }
        // Deep vertical bays, gold-lit lancet windows, and stone buttresses.
        const bays=Math.max(3,Math.floor(w/2.8));
        for(let i=0;i<bays;i++){
          const x=-w*.42+i*(w*.84/(bays-1));
          box(x,h*.5,d*.505,.56,h*.72,.2,trim,g);
          frontWindow(x,h*.58,Math.min(.52,w/bays*.3),h*.35);
          frontWindow(x,h*.82,Math.min(.4,w/bays*.24),h*.13,d*.5+.18,windowDark);
        }
        for(const side of [-1,1])for(let z=-d*.32;z<=d*.32;z+=Math.max(2.2,d*.32)){
          box(side*(w*.5+.24),h*.34,z,.55,h*.7,.9,trim,g);
          box(side*(w*.5+.31),h*.72,z,.7,.18,1.05,stone[2],g);
          box(side*(w*.5+.34),h*.51,z,.12,h*.28,.58,windowDark,g);
        }
        // Recessed ceremonial entrance, stair, columns, lintel, and rose window.
        box(0,1.55,d*.55,w*.25,3.1,.48,0x342c27,g);
        for(const cx of [-w*.16,w*.16])column(cx,1.75,d*.79,3.2,trim,.2);
        box(0,3.42,d*.8,w*.42,.28,.55,trim,g);
        for(let step=0;step<3;step++)box(0,.16+step*.12,d*.69+step*.23,w*.43-step*.18,.22,.34,stone[1],g);
        detail(new THREE.TorusGeometry(Math.min(1,h*.085),.16,6,12),trim,0,h*.7,d*.63,0,0,0);
        detail(new THREE.TorusGeometry(Math.min(.62,h*.052),.08,5,10),windowGlow,0,h*.7,d*.65,0,0,0);
        for(let a=0;a<8;a++){const spoke=box(0,h*.7,d*.67,.06,Math.min(1.7,h*.14),.05,trim,g);spoke.rotation.z=a*Math.PI/4;}
      }else if(style===1){
        box(0,h*.43,0,w,h*.86,d,0x5d584d,g);
        box(0,h*.91,0,w+.5,.5,d+.45,0x242a29,g);
        for(const y of [h*.24,h*.48,h*.72])box(0,y,-d*.505,w+.1,.12,.18,0x9d927a,g);
        // Projecting street facade with heavy cornice and repeated illuminated bays.
        box(0,h*.52,d*.51,w+.75,h*.74,.42,0x48483f,g);
        box(0,h*.91,d*.54,w+1.15,.45,.78,trim,g);
        box(0,h*.14,d*.57,w+1,.42,.75,0x2c302d,g);
        const bays=Math.max(4,Math.floor(w/2.25));
        for(let i=0;i<bays;i++){
          const x=-w*.43+i*(w*.86/(bays-1));
          box(x,h*.55,d*.745,.28,h*.56,.2,trim,g);
          box(x,h*.58,d*.765,Math.max(.7,w/bays*.52),h*.36,.12,windowGlow,g);
          box(x,h*.78,d*.78,Math.max(.75,w/bays*.58),.18,.12,0x303533,g);
          box(x,h*.58,d*.84,.055,h*.36,.05,0x252b2a,g);
          box(x,h*.58,d*.84,Math.max(.7,w/bays*.52),.055,.05,0x252b2a,g);
          box(x,h*.96,d*.55,.2,h*.35,.72,trim,g);
        }
        for(const side of [-1,1])for(let z=-d*.32;z<=d*.28;z+=2.1){
          box(side*(w*.505),h*.55,z,.12,h*.32,1.15,windowDark,g);
          box(side*(w*.52),h*.55,z,.08,h*.38,.12,trim,g);
        }
        box(0,h*.27,d*.82,w*.72,.5,.2,0x9b7948,g);
        box(0,h*.27,d*.95,w*.52,.08,.1,0xd0b36d,g);
        box(0,1.25,d*.8,w*.15,2.5,.2,0x2b2422,g);
        box(0,2.62,d*.83,w*.22,.18,.3,trim,g);
        box(0,.42,d*.88,w*.58,.16,1.25,0x777167,g);
        // Roof plant, vents and a stepped parapet break up the silhouette.
        box(0,h*.99,0,w*.45,.48,d*.5,0x343936,g);
        box(-w*.2,h*1.06,-d*.12,w*.18,.55,d*.2,0x686a62,g);
        detail(new THREE.CylinderGeometry(.18,.18,1.2,8),0x323736,w*.22,h*1.09,d*.12);
      }else if(style===2){
        box(-w*.08,h*.43,0,w*.84,h*.86,d,0xa8a394,g);
        // Stepped rounded corner is built from low-sided cylinders, echoing the
        // pale streamline-moderne building at the top of the reference.
        const corner=new THREE.Mesh(new THREE.CylinderGeometry(d*.5,d*.5,h*.84,12,1,false,0,Math.PI),mat(0xaaa596));
        corner.rotation.y=Math.PI/2;corner.position.set(w*.34,h*.42,0);corner.castShadow=corner.receiveShadow=true;g.add(corner);
        for(const y of [h*.24,h*.48,h*.72]){
          box(-w*.08,y,d*.505,w*.84,.18,.22,trim,g);
          box(-w*.08,y,-d*.505,w*.84,.18,.22,trim,g);
          box(-w*.505,y,0,.2,.18,d+.12,trim,g);
        }
        for(let x=-w*.4;x<w*.27;x+=2.1){
          box(x,h*.52,d*.522,1.15,h*.48,.12,windowDark,g);
          box(x,h*.52,-d*.522,1.15,h*.48,.12,windowDark,g);
          box(x,h*.52,d*.59,.055,h*.48,.05,trim,g);
          box(x,h*.52,-d*.59,.055,h*.48,.05,trim,g);
        }
        for(let z=-d*.38;z<=d*.38;z+=1.8)box(-w*.505,h*.52,z,.12,h*.45,.9,windowDark,g);
        box(-w*.08,h*.91,0,w*.9,.55,d+1,roofDark,g);
        box(-w*.24,h*.99,0,w*.56,.5,d*.62,0x777b75,g);
        box(-w*.12,h*1.07,0,w*.28,.35,d*.32,0x555b57,g);
        for(const sx of [-1,1])detail(new THREE.CylinderGeometry(.12,.16,1.4,8),0x383e3b,sx*w*.23,h*1.15,0);
        // Ground-floor arcade and wraparound canopy.
        box(-w*.09,h*.19,d*.63,w*.9,.18,.82,0x5b5d58,g);
        const arcade=Math.max(3,Math.floor(w/2));
        for(let i=0;i<arcade;i++){
          const x=-w*.4+i*(w*.72/(arcade-1));
          column(x,1.35,d*.74,2.2,trim,.14);
          box(x,1.28,d*.78,Math.max(.65,w/arcade*.52),1.65,.11,windowGlow,g);
        }
      }else{
        // Low industrial fire-station/warehouse: sawtooth roof, roller doors,
        // exposed tanks and a narrow brick office tower.
        box(0,h*.32,0,w,h*.64,d,0x76594a,g);
        for(let x=-w*.42;x<=w*.42;x+=Math.max(2.5,w/4)){
          box(x,1.35,d*.515,Math.max(1.7,w/5),2.7,.16,0x343b3b,g);
          for(let y=.45;y<2.45;y+=.42)box(x,y,d*.62,Math.max(1.55,w/5-.16),.06,.05,0x8b8d80,g);
        }
        box(-w*.35,h*.62,0,w*.22,h*.58,d*.72,0x5b4037,g);
        for(const y of [h*.45,h*.62,h*.79])box(-w*.35,y,d*.37,w*.13,.24,.12,windowGlow,g);
        for(let x=-w*.35;x<=w*.35;x+=Math.max(2.8,w/3)){
          const roof=detail(new THREE.ConeGeometry(Math.max(1.7,w*.15),2.1,4),0x344345,x,h*.72,0,0,Math.PI/4,0);
          roof.scale.z=Math.max(.7,d/w);
        }
        box(0,h*.68,-d*.2,w*.72,.28,d*.4,0x3b4443,g);
        const tank=detail(new THREE.CylinderGeometry(.65,.65,2.6,8),0x72776f,w*.35,h*.82,-d*.24);
        tank.rotation.z=Math.PI/2;
        detail(new THREE.CylinderGeometry(.13,.18,2.8,8),0x303635,w*.13,h*.91,-d*.22);
        box(0,3.05,d*.65,w*.62,.72,.18,0xc29a48,g);
        box(0,3.05,d*.76,w*.49,.1,.08,0x242b2a,g);
      }
    };
    let blockIndex=0;
    for (const bx of blocks) for (const bz of blocks) {
      const surface=new THREE.Mesh(boxGeo,grassMaterial);surface.position.set(bx,.08,bz);surface.scale.set(38,.18,38);surface.receiveShadow=true;scene.add(surface);
      // Raised white curb and a continuous pedestrian pavement isolate every lot from traffic.
      box(bx,.25,bz-19.15,38.6,.32,.42,0xf0eee2);box(bx,.25,bz+19.15,38.6,.32,.42,0xf0eee2);
      box(bx-19.15,.25,bz,.42,.32,38.6,0xf0eee2);box(bx+19.15,.25,bz,.42,.32,38.6,0xf0eee2);
      box(bx,.2,bz-17.45,34.4,.12,2.8,palette.concrete);box(bx,.2,bz+17.45,34.4,.12,2.8,palette.concrete);
      box(bx-17.45,.2,bz,2.8,.12,34.4,palette.concrete);box(bx+17.45,.2,bz,2.8,.12,34.4,palette.concrete);

      const layouts=[
        [{x:-8.4,z:-8.4,w:15.8,d:15.8},{x:8.4,z:-8.4,w:15.8,d:15.8},{x:-8.4,z:8.4,w:15.8,d:15.8},{x:8.4,z:8.4,w:15.8,d:15.8}],
        [{x:0,z:-8.5,w:33,d:16},{x:0,z:8.5,w:33,d:16}],
        [{x:0,z:0,w:33,d:33}],
        [{x:-8.5,z:0,w:16,d:33},{x:8.5,z:0,w:16,d:33}],
      ][blockIndex++];
      // Internal walkways divide larger blocks into readable sub-lots.
      if(layouts.length===4){box(bx,.2,bz,2.2,.13,34,palette.concrete);box(bx,.2,bz,34,.13,2.2,palette.concrete);}
      else if(layouts.length===2){const vertical=Math.abs(layouts[0].x-layouts[1].x)>1;box(bx,.2,bz,vertical?2.2:34,.13,vertical?34:2.2,palette.concrete);}

      for(const parcel of layouts){
        const buildingScale=.52+rng()*.22,w=Math.max(7,parcel.w*buildingScale),d=Math.max(7,parcel.d*(.5+rng()*.23));
        const areaFactor=Math.sqrt(parcel.w*parcel.d)/12,h=6+Math.floor((areaFactor+rng()*2.4))*3;
        const x=bx+parcel.x+(rng()-.5)*Math.max(0,parcel.w-w-3),z=bz+parcel.z+(rng()-.5)*Math.max(0,parcel.d-d-3);
        const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
        addReferenceBuilding(g,w,h,d,(buildings.length+blockIndex)%4);
        // Short path from the building entrance to the parcel pedestrian network.
        box(x,.21,z+d/2+Math.max(1,(parcel.d-d)*.2),2,.1,Math.max(2,parcel.d-d),palette.concrete);
        buildings.push(g);targets.push({mesh:g,radius:Math.max(w,d)*.55,height:h,value:Math.round(h*w*d*4),kind:"building",minSize:3+h*.055,alive:true});
        const openX=bx+parcel.x+(parcel.x<=0?-1:1)*parcel.w*.38,openZ=bz+parcel.z+(parcel.z<=0?-1:1)*parcel.d*.37;
        if(Math.abs(openX-x)>w*.35||Math.abs(openZ-z)>d*.35)plannedTreePositions.push({x:openX,z:openZ});
        if(parcel.w*parcel.d>650)plannedTreePositions.push({x:bx+parcel.x-parcel.w*.32,z:bz+parcel.z+parcel.d*.34});
      }
    }

    // Street furniture follows the road geometry rather than being scattered:
    // lamps sit behind each curb and their arms always reach toward the lane.
    const lampMetal=0x263638,lampGlow=new THREE.MeshStandardMaterial({color:0x6d694e,emissive:0xffb338,emissiveIntensity:0,roughness:.35});
    const lampBeamMaterial=new THREE.MeshBasicMaterial({
      color:0xffc65c,transparent:true,opacity:0,depthWrite:false,side:THREE.DoubleSide,
      blending:THREE.AdditiveBlending,
    });
    const lampBeamGeometry=new THREE.ConeGeometry(4.8,5.3,16,1,true);
    const lampBeams:THREE.Mesh[]=[];
    const lampPools:THREE.PointLight[]=[];
    const lampFixtures:{position:THREE.Vector3;beam:THREE.Mesh;groundPool:THREE.Mesh}[]=[];
    const lampPoolCanvas=document.createElement("canvas");lampPoolCanvas.width=lampPoolCanvas.height=128;
    const lampPoolContext=lampPoolCanvas.getContext("2d")!;
    const lampPoolGradient=lampPoolContext.createRadialGradient(64,64,0,64,64,64);
    lampPoolGradient.addColorStop(0,"rgba(255,211,112,.72)");
    lampPoolGradient.addColorStop(.28,"rgba(255,191,72,.38)");
    lampPoolGradient.addColorStop(.68,"rgba(255,174,48,.1)");
    lampPoolGradient.addColorStop(1,"rgba(255,160,30,0)");
    lampPoolContext.fillStyle=lampPoolGradient;lampPoolContext.fillRect(0,0,128,128);
    const lampPoolTexture=new THREE.CanvasTexture(lampPoolCanvas);lampPoolTexture.colorSpace=THREE.SRGBColorSpace;
    const lampPoolMaterial=new THREE.MeshBasicMaterial({map:lampPoolTexture,color:0xffd083,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
    const addStreetLamp=(x:number,z:number,vertical:boolean,side:number,index:number)=>{
      const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
      box(0,2.9,0,.15,5.8,.15,lampMetal,g);
      const toward=side<0?1:-1;
      let headX=0,headZ=0;
      if(vertical){
        box(toward*.55,5.72,0,1.1,.12,.12,lampMetal,g);
        const head=new THREE.Mesh(boxGeo,lampGlow);head.position.set(toward*1.08,5.58,0);head.scale.set(.52,.13,.36);g.add(head);
        headX=toward*1.08;
      }else{
        box(0,5.72,toward*.55,.12,.12,1.1,lampMetal,g);
        const head=new THREE.Mesh(boxGeo,lampGlow);head.position.set(0,5.58,toward*1.08);head.scale.set(.36,.13,.52);g.add(head);
        headZ=toward*1.08;
      }
      // Every fixture gets a visible widening pool, matching the triangular
      // silhouette of a real street lamp seen through humid night air.
      const beam=new THREE.Mesh(lampBeamGeometry,lampBeamMaterial);
      beam.position.set(headX,2.88,headZ);beam.renderOrder=1;g.add(beam);lampBeams.push(beam);
      const groundPool=new THREE.Mesh(new THREE.PlaneGeometry(10.5,10.5),lampPoolMaterial);
      groundPool.rotation.x=-Math.PI/2;groundPool.position.set(headX,.185,headZ);groundPool.renderOrder=1;g.add(groundPool);
      lampFixtures.push({position:new THREE.Vector3(x+headX,.8,z+headZ),beam,groundPool});
    };
    let lampIndex=0;
    for(const road of verticalRoads)for(const side of [-1,1])for(let along=-72;along<=72;along+=18){
      // Skip the centres of crossing roads so poles never stand in crosswalks.
      if(horizontalRoads.some(crossing=>Math.abs(along-crossing.at)<crossing.width/2+2))continue;
      addStreetLamp(road.at+side*(road.width/2+1.25),along,true,side,lampIndex++);
    }
    for(const road of horizontalRoads)for(const side of [-1,1])for(let along=-72;along<=72;along+=18){
      if(verticalRoads.some(crossing=>Math.abs(along-crossing.at)<crossing.width/2+2))continue;
      addStreetLamp(along,road.at+side*(road.width/2+1.25),false,side,lampIndex++);
    }
    // Dozens of simultaneous point lights make WebGL compile and evaluate every
    // surface against every light. Six pooled lights follow the nearest fixtures;
    // all other lamps retain their inexpensive emissive head and GPU-blended pool.
    for(let i=0;i<6;i++){
      const pool=new THREE.PointLight(0xffb94f,0,10.5,2.15);pool.visible=false;scene.add(pool);lampPools.push(pool);
    }

    // Open iron fencing runs along lot edges in short sections, with deliberate
    // gaps opposite paths and building entrances.
    const addFenceRun=(x:number,z:number,length:number,vertical:boolean)=>{
      const group=new THREE.Group();group.position.set(x,0,z);scene.add(group);
      const segments=Math.max(2,Math.round(length/2.25)),step=length/segments;
      for(let i=0;i<=segments;i++){
        const p=-length/2+i*step;
        box(vertical?0:p,1.05,vertical?p:0,.13,2.05,.13,0x263538,group);
      }
      for(const height of [.45,1.55])box(0,height,0,vertical ? .1 : length,.09,vertical ? length : .1,0x35484a,group);
      for(let i=0;i<segments;i++){
        const p=-length/2+(i+.5)*step,brace=box(vertical?0:p,1,vertical?p:0,vertical?.08:step*.96,.08,vertical?step*.96:.08,0x405456,group);
        if(vertical)brace.rotation.x=(i%2?1:-1)*.52;else brace.rotation.z=(i%2?1:-1)*.52;
      }
    };
    for(const bx of blocks)for(const bz of blocks){
      for(const offset of [-9.8,9.8]){
        addFenceRun(bx+offset,bz-15.3,8.4,false);addFenceRun(bx+offset,bz+15.3,8.4,false);
        addFenceRun(bx-15.3,bz+offset,8.4,true);addFenceRun(bx+15.3,bz+offset,8.4,true);
      }
    }

    const billboardColors=[["#d7b646","#672926"],["#80a9a3","#192e38"],["#c9c5a4","#3d5039"],["#bb5a3c","#e3c474"]];
    const addBillboard=(x:number,z:number,rotation:number,label:string,index:number)=>{
      const canvas=document.createElement("canvas");canvas.width=256;canvas.height=112;const context=canvas.getContext("2d")!;
      const colors=billboardColors[index%billboardColors.length];context.fillStyle=colors[0];context.fillRect(0,0,256,112);
      for(let i=0;i<180;i++){context.fillStyle=`rgba(20,30,27,${.03+rng()*.16})`;context.fillRect(rng()*256,rng()*112,1+rng()*8,1+rng()*3);}
      context.strokeStyle=colors[1];context.lineWidth=8;context.strokeRect(5,5,246,102);
      context.fillStyle=colors[1];context.font="900 32px Impact, sans-serif";context.textAlign="center";context.fillText(label,128,55);
      context.font="bold 13px Arial";context.fillText("CITY SERVICE • OPEN ALL NIGHT",128,80);
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;
      const group=new THREE.Group();group.position.set(x,0,z);group.rotation.y=rotation;scene.add(group);
      for(const px of [-2.6,2.6])box(px,2.1,0,.18,4.2,.18,0x4a5350,group);
      const board=new THREE.Mesh(new THREE.PlaneGeometry(6.8,3),new THREE.MeshStandardMaterial({map:texture,roughness:.9,side:THREE.DoubleSide}));
      board.position.set(0,4.2,0);board.castShadow=true;group.add(board);
      box(0,4.2,-.1,7,3.2,.14,0x333b39,group);
    };
    addBillboard(-42,-11,0,"NIGHT DRIVE",0);addBillboard(41,11,Math.PI,"MEAT MARKET",1);
    addBillboard(-11,39,Math.PI/2,"STAY ALERT",2);addBillboard(11,-41,-Math.PI/2,"FIRE SAFE",3);

    type VehicleAgent={mesh:THREE.Group;kind:"civilian"|"police"|"swat"|"fire";axis:"x"|"z";direction:1|-1;speed:number;maxSpeed:number;acceleration:number;heading:number;targetHeading:number;state:"road"|"pursue"|"parked"|"flee"|"crashed";crewDeployed:boolean;turnCooldown:number;brakeSpeed:number;reverseTimer:number;target?:THREE.Vector3;crash?:{age:number;smoke:THREE.Sprite;flame:THREE.Sprite}};
    const vehicleAgents:VehicleAgent[]=[];
    const addCar = (x:number,z:number,c:number,rot=0) => {
      const g=new THREE.Group(); g.position.set(x,.7,z); g.rotation.y=rot; scene.add(g);
      box(0,0,0,3.3,.75,1.65,c,g); box(-.25,.65,0,1.7,.65,1.45,0x5c7278,g);
      for(const xx of [-1.05,1.05]) for(const zz of [-.86,.86]) { const w=new THREE.Mesh(cylGeo,mat(0x17191b)); w.scale.set(.38,.22,.38); w.rotation.x=Math.PI/2; w.position.set(xx,-.42,zz); g.add(w); }
      targets.push({mesh:g,radius:2.1,height:1.7,value:8500,kind:"car",minSize:1.45,alive:true});
      return g;
    };
    const glowCanvas=document.createElement("canvas"); glowCanvas.width=glowCanvas.height=128;
    const glowContext=glowCanvas.getContext("2d")!;
    const glowGradient=glowContext.createRadialGradient(64,64,2,64,64,64);
    glowGradient.addColorStop(0,"rgba(255,255,255,1)");
    glowGradient.addColorStop(.12,"rgba(255,255,255,.95)");
    glowGradient.addColorStop(.38,"rgba(255,255,255,.35)");
    glowGradient.addColorStop(1,"rgba(255,255,255,0)");
    glowContext.fillStyle=glowGradient; glowContext.fillRect(0,0,128,128);
    const glowTexture=new THREE.CanvasTexture(glowCanvas);
    // Explosion resources are allocated and shader-warmed during loading. Creating
    // dozens of geometries and compiling transparent shaders on first impact caused
    // the former multi-second hitch.
    const explosionFireBases=[0xfff1a0,0xff9b22,0xe8420c].map(color=>new THREE.SpriteMaterial({map:glowTexture,color,transparent:true,opacity:.96,depthWrite:false,blending:THREE.AdditiveBlending}));
    const explosionSmokeBases=[0x2c2926,0x45403a,0x5b5145].map(color=>new THREE.SpriteMaterial({map:glowTexture,color,transparent:true,opacity:.62,depthWrite:false,blending:THREE.NormalBlending}));
    const explosionSparkGeometry=new THREE.BoxGeometry(.045,.045,.65);
    const explosionRingGeometry=new THREE.RingGeometry(.7,1,32);
    const explosionWarmup=new THREE.Group();explosionWarmup.position.set(0,-1000,0);
    for(const material of [...explosionFireBases,...explosionSmokeBases])explosionWarmup.add(new THREE.Sprite(material));
    explosionWarmup.add(new THREE.Mesh(explosionSparkGeometry,new THREE.MeshBasicMaterial({color:0xffc14b})));
    explosionWarmup.add(new THREE.Mesh(explosionRingGeometry,new THREE.MeshBasicMaterial({color:0xffb52f,transparent:true,blending:THREE.AdditiveBlending})));
    scene.add(explosionWarmup);
    const policeLights: {
      red: THREE.MeshStandardMaterial; blue: THREE.MeshStandardMaterial;
      redGlow: THREE.SpriteMaterial; blueGlow: THREE.SpriteMaterial;
      redPoint: THREE.PointLight; bluePoint: THREE.PointLight;
      redSprite: THREE.Sprite; blueSprite: THREE.Sprite;
    }[] = [];
    const addPoliceCar = (x:number,z:number,rot=0) => {
      const g=new THREE.Group(); g.position.set(x,.72,z); g.rotation.y=rot; scene.add(g);
      // Wide low-poly American patrol sedan silhouette, matching the recurring reference vehicle.
      box(0,0,0,3.65,.62,1.72,0x202b2f,g);
      box(-.08,.34,0,3.25,.38,1.7,0x70b9c6,g);
      box(.02,.62,0,2.45,.16,1.64,0x172327,g);
      box(-.18,.97,0,1.95,.72,1.48,0x8ecbd2,g);
      // Dark windshield/rear glass and side window band.
      box(-1.18,.97,0,0.09,.55,1.32,0x17242a,g);
      box(.84,.97,0,0.09,.55,1.32,0x17242a,g);
      for(const side of [-1,1]) {
        box(-.2,.98,side*.755,1.58,.49,.045,0x17242a,g);
        box(-.18,.28,side*.875,1.62,.12,.055,0xe7e5d6,g);
        box(-.14,.23,side*.91,.08,.11,.08,0xd8d4c4,g);
      }
      // Hood, trunk, bumpers, grille, lamps and mirrors.
      box(-1.45,.53,0,.62,.16,1.6,0x76bdc8,g);
      box(1.48,.49,0,.68,.15,1.58,0x6eb5c1,g);
      box(-1.86,-.05,0,.18,.23,1.72,0x111619,g);
      box(1.87,-.05,0,.18,.23,1.72,0x111619,g);
      box(-1.97,.1,0,.07,.24,.76,0xd9d6c7,g);
      box(-1.88,.18,-.6,.06,.22,.28,0xf0e2a5,g);
      box(-1.88,.18,.6,.06,.22,.28,0xf0e2a5,g);
      box(1.88,.18,-.59,.06,.22,.3,0xb62222,g);
      box(1.88,.18,.59,.06,.22,.3,0xb62222,g);
      box(-.48,.84,-.84,.3,.16,.1,0x182126,g);
      box(-.48,.84,.84,.3,.16,.1,0x182126,g);
      // Four complete wheels: tire, cyan hub and small axle cap.
      for(const xx of [-1.18,1.15]) for(const zz of [-.88,.88]) {
        const wheel=new THREE.Mesh(cylGeo,mat(0x101315)); wheel.scale.set(.43,.24,.43); wheel.rotation.x=Math.PI/2; wheel.position.set(xx,-.31,zz); g.add(wheel);
        const hub=new THREE.Mesh(cylGeo,mat(0x86b9bc)); hub.scale.set(.2,.255,.2); hub.rotation.x=Math.PI/2; hub.position.set(xx,-.31,zz); g.add(hub);
      }
      // Roof siren with separate emissive materials for an alternating police flash.
      const redMat=new THREE.MeshStandardMaterial({color:0xff274d,emissive:0xff082c,emissiveIntensity:3,roughness:.25});
      const blueMat=new THREE.MeshStandardMaterial({color:0x21d8ff,emissive:0x00a9ff,emissiveIntensity:.35,roughness:.25});
      box(-.18,1.38,0,.96,.09,.16,0x13191b,g);
      const red=new THREE.Mesh(boxGeo,redMat); red.position.set(-.48,1.5,0); red.scale.set(.52,.18,.3); g.add(red);
      const blue=new THREE.Mesh(boxGeo,blueMat); blue.position.set(.2,1.5,0); blue.scale.set(.52,.18,.3); g.add(blue);
      const redGlow=new THREE.SpriteMaterial({map:glowTexture,color:0xff1645,transparent:true,opacity:.9,depthWrite:false,blending:THREE.AdditiveBlending});
      const blueGlow=new THREE.SpriteMaterial({map:glowTexture,color:0x16bfff,transparent:true,opacity:.12,depthWrite:false,blending:THREE.AdditiveBlending});
      const redSprite=new THREE.Sprite(redGlow); redSprite.position.set(-.48,1.65,0); redSprite.scale.set(5.4,5.4,1); g.add(redSprite);
      const blueSprite=new THREE.Sprite(blueGlow); blueSprite.position.set(.2,1.65,0); blueSprite.scale.set(5.4,5.4,1); g.add(blueSprite);
      const redPoint=new THREE.PointLight(0xff1748,0,9,2); redPoint.position.set(-.48,1.65,0); g.add(redPoint);
      const bluePoint=new THREE.PointLight(0x1bbfff,0,9,2); bluePoint.position.set(.2,1.65,0); g.add(bluePoint);
      policeLights.push({red:redMat,blue:blueMat,redGlow,blueGlow,redPoint,bluePoint,redSprite,blueSprite});
      targets.push({mesh:g,radius:2.25,height:1.9,value:12500,kind:"car",minSize:1.55,alive:true});
      return g;
    };
    const addFireTruck=(x:number,z:number,rot=0)=>{
      const g=new THREE.Group();g.position.set(x,1.02,z);g.rotation.y=rot;scene.add(g);
      const fireRed=0xb72e24,darkRed=0x641b19,trim=0xd9d3bb,metal=0x747d7a;
      // Long cab-over fire engine with a raised equipment body.
      box(-1.8,-.08,0,2.15,1.38,2.05,fireRed,g);
      box(.9,.05,0,3.45,1.72,2.08,darkRed,g);
      box(.95,.16,0,3.22,1.42,2.13,fireRed,g);
      // A proper squared cab: roof brow, two-piece front glass, grille and lamps.
      box(-1.82,1.03,0,2.05,.2,2.14,darkRed,g);
      box(-2.48,.58,-.52,.075,.62,.82,0x78a6a7,g);
      box(-2.48,.58,.52,.075,.62,.82,0x78a6a7,g);
      box(-2.53,-.12,0,.08,.46,1.12,0x2b3030,g);
      for(let bar=-.36;bar<=.36;bar+=.18)box(-2.58,-.12,bar,.055,.31,.045,0xb9b7aa,g);
      box(-2.6,-.46,0,.2,.18,2.18,trim,g);
      box(-2.62,.08,-.76,.08,.3,.32,0xffe6a2,g);
      box(-2.62,.08,.76,.08,.3,.32,0xffe6a2,g);
      box(-2.63,-.2,-.76,.07,.16,.25,0xca2820,g);
      box(-2.63,-.2,.76,.07,.16,.25,0xca2820,g);
      box(2.7,-.38,0,.18,.2,2.16,trim,g);
      // Windscreen, side windows and cream department stripe.
      for(const side of [-1,1]){
        box(-1.7,.57,side*1.055,.82,.58,.055,0x263c42,g);
        box(-1.08,.57,side*1.058,.34,.58,.05,fireRed,g);
        box(-1.55,-.12,side*1.075,.07,.3,.06,trim,g);
        box(.38,.15,side*1.085,3.92,.24,.055,trim,g);
        // Equipment compartment doors, handles and rolled hose outlets.
        for(let px=-.3;px<=2.05;px+=.78){
          box(px,.42,side*1.09,.66,.88,.04,0x98251f,g);
          box(px,.52,side*1.125,.23,.055,.035,trim,g);
        }
        const hose=new THREE.Mesh(cylGeo,mat(0xd1b355));hose.rotation.x=Math.PI/2;hose.position.set(1.9,.42,side*1.14);hose.scale.set(.28,.06,.28);g.add(hose);
      }
      // Roof ladder, rails, rear water cannon and side piping.
      for(const side of [-1,1])box(.65,1.28,side*.72,3.65,.12,.13,metal,g);
      for(let px=-1;px<=2.2;px+=.48)box(px,1.28,0,.08,.1,1.5,metal,g);
      box(.65,1.25,0,3.65,.1,.12,trim,g);
      const cannonBase=new THREE.Mesh(cylGeo,mat(metal));cannonBase.position.set(2.02,1.18,0);cannonBase.scale.set(.34,.22,.34);g.add(cannonBase);
      const cannon=box(2.28,1.48,0,.75,.13,.13,trim,g);cannon.rotation.z=-.32;
      for(const side of [-1,1])box(.55,-.58,side*1.12,3.75,.12,.12,0xb7a998,g);
      // Six wheels support the longer silhouette.
      for(const xx of [-1.75,.8,2.05])for(const zz of [-1.08,1.08]){
        const wheel=new THREE.Mesh(cylGeo,mat(0x111416));wheel.scale.set(.48,.25,.48);wheel.rotation.x=Math.PI/2;wheel.position.set(xx,-.73,zz);g.add(wheel);
        const hub=new THREE.Mesh(cylGeo,mat(0xb7b8ae));hub.scale.set(.21,.265,.21);hub.rotation.x=Math.PI/2;hub.position.set(xx,-.73,zz);g.add(hub);
      }
      // Alternating red emergency beacons reuse the game's bloom texture.
      for(const side of [-1,1]){
        const beaconMat=new THREE.MeshStandardMaterial({color:0xff3128,emissive:0xff160c,emissiveIntensity:2.8,roughness:.25});
        const beacon=new THREE.Mesh(cylGeo,beaconMat);beacon.position.set(-1.7,1.25,side*.65);beacon.scale.set(.18,.16,.18);g.add(beacon);
        const glowMat=new THREE.SpriteMaterial({map:glowTexture,color:0xff291c,transparent:true,opacity:.62,depthWrite:false,blending:THREE.AdditiveBlending});
        const glow=new THREE.Sprite(glowMat);glow.position.copy(beacon.position);glow.scale.set(3.8,3.8,1);g.add(glow);
      }
      targets.push({mesh:g,radius:3.25,height:2.55,value:18000,kind:"car",minSize:1.85,alive:true});
      return g;
    };
    const roadVals=[-54,0,54];
    // Only civilian traffic is present at load. Emergency units are dispatched
    // from beyond the visible city after the disaster begins.
    for(let i=0;i<26;i++) {
      const vertical=rng()>.5, lane=(rng()>.5?1:-1)*4.2, main=roadVals[Math.floor(rng()*3)], along=-78+rng()*156;
      const x=vertical?main+lane:along, z=vertical?along:main+lane, rot=vertical?0:Math.PI/2;
      const car=addCar(x,z,[0xd7c850,0xa93f39,0x507c8b,0xddd9c7,0x24292e][i%5],rot);
      const direction=(rng()>.5?1:-1) as 1|-1,heading=vertical?(direction>0?Math.PI/2:-Math.PI/2):(direction>0?0:Math.PI);
      vehicleAgents.push({mesh:car,kind:"civilian",axis:vertical?"z":"x",direction,speed:0,maxSpeed:8.5+rng()*2.5,acceleration:2.8,heading,targetHeading:heading,state:"road",crewDeployed:false,turnCooldown:0,brakeSpeed:0,reverseTimer:0});
    }

    const foliagePalettes=[
      ["#172d22","#274735","#3d6248","#668064"],
      ["#263629","#41523a","#64704b","#89906a"],
      ["#402d24","#66422e","#8b5a3b","#ad7950"],
      ["#1d302e","#334b45","#50665b","#718378"],
    ];
    const foliageMaterials=foliagePalettes.map((colors,index)=>{
      const canvas=document.createElement("canvas");canvas.width=canvas.height=64;const context=canvas.getContext("2d")!,random=seeded(50120+index*811);
      for(let cluster=0;cluster<14;cluster++){
        const cx=14+random()*36,cy=12+random()*40,radius=5+random()*12;
        for(let dot=0;dot<34;dot++){
          const angle=random()*Math.PI*2,distance=Math.pow(random(),1.7)*radius,size=1+Math.floor(random()*5);
          context.fillStyle=colors[Math.floor(random()*colors.length)];
          context.fillRect(Math.round(cx+Math.cos(angle)*distance),Math.round(cy+Math.sin(angle)*distance),size,size);
        }
      }
      const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;
      return new THREE.MeshStandardMaterial({map:texture,roughness:1,metalness:0,transparent:true,alphaTest:.24,side:THREE.DoubleSide,depthWrite:true});
    });
    const foliagePlane=new THREE.PlaneGeometry(1,1);
    const addTree=(x:number,z:number)=>{
      const g=new THREE.Group();g.position.set(x,0,z);scene.add(g);
      const totalHeight=3.8+rng()*4.4,trunkHeight=totalHeight*(.48+rng()*.12),trunkWidth=.34+rng()*.34;
      const treeForm=Math.floor(rng()*3); // broadleaf, conifer, or tall sparse crown
      const trunkColor=[0x3c3022,0x493627,0x58412b][Math.floor(rng()*3)];
      const trunk=new THREE.Mesh(cylGeo,mat(trunkColor));trunk.position.y=trunkHeight/2;trunk.scale.set(trunkWidth,trunkHeight,trunkWidth);trunk.castShadow=true;g.add(trunk);
      const branchCount=treeForm===1?0:treeForm===2?5+Math.floor(rng()*3):2+Math.floor(rng()*4);
      for(let i=0;i<branchCount;i++){
        const start=new THREE.Vector3(0,trunkHeight*(.62+rng()*.3),0),a=rng()*Math.PI*2;
        const end=new THREE.Vector3(Math.cos(a)*(1+rng()*1.3),start.y+.4+rng()*1.15,Math.sin(a)*(1+rng()*1.3));
        const direction=end.clone().sub(start),branch=new THREE.Mesh(cylGeo,mat(trunkColor));
        branch.position.copy(start).add(end).multiplyScalar(.5);branch.scale.set(trunkWidth*.42,direction.length(),trunkWidth*.42);
        branch.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.clone().normalize());branch.castShadow=true;g.add(branch);
      }
      const foliageMaterial=foliageMaterials[Math.floor(rng()*foliageMaterials.length)];
      let crownRadius=1.2;
      if(treeForm===1){
        // Tiered low-poly conifer, intentionally angular at PS1 distance.
        const coniferMaterial=mat([0x263f32,0x344d37,0x465a3d][Math.floor(rng()*3)]);
        for(let tier=0;tier<4;tier++){
          const cone=new THREE.Mesh(new THREE.ConeGeometry(1.65-tier*.18,2.5,7),coniferMaterial);
          cone.position.y=trunkHeight*.58+tier*1.05;cone.castShadow=true;g.add(cone);
        }
        crownRadius=1.8;
      }else{
        const sparse=treeForm===2||rng()<.2,clusterCount=treeForm===2?4+Math.floor(rng()*3):sparse?3+Math.floor(rng()*3):7+Math.floor(rng()*6);
        for(let i=0;i<clusterCount;i++){
          const a=rng()*Math.PI*2,spread=(treeForm===2?1.35:sparse?.65:1.05)+rng()*(treeForm===2?1.3:sparse?.8:1.35);
          const crown=new THREE.Group();crown.position.set(Math.cos(a)*spread,trunkHeight+(treeForm===2?.12:rng()-.18)*totalHeight*.24,Math.sin(a)*spread);
          const size=(treeForm===2?.55:sparse?.65:1)+(rng()*(treeForm===2?.55:sparse?.75:1.2));
          for(let planeIndex=0;planeIndex<3;planeIndex++){
            const plane=new THREE.Mesh(foliagePlane,foliageMaterial);plane.scale.set(size*(1.65+rng()*.45),size*(1.65+rng()*.65),1);
            if(planeIndex<2)plane.rotation.y=planeIndex*Math.PI/2+rng()*.3;else plane.rotation.x=Math.PI/2;
            plane.castShadow=true;plane.receiveShadow=true;crown.add(plane);
          }
          crown.rotation.y=rng()*Math.PI;g.add(crown);
          crownRadius=Math.max(crownRadius,spread+size);
        }
      }
      targets.push({mesh:g,radius:crownRadius,baseRadius:trunkWidth,height:totalHeight,value:1800,kind:"tree",minSize:1.25,alive:true});
    };
    // Trees are placed only inside parcel open space; none can overlap a road or intersection.
    for(const position of plannedTreePositions)addTree(position.x+(rng()-.5)*1.4,position.z+(rng()-.5)*1.4);
    for(let i=0;i<20;i++){
      const bx=blocks[Math.floor(rng()*blocks.length)],bz=blocks[Math.floor(rng()*blocks.length)];
      const x=bx+(rng()-.5)*26,z=bz+(rng()-.5)*26;
      const clearOfBuilding=buildings.every(building=>Math.hypot(building.position.x-x,building.position.z-z)>8);
      if(clearOfBuilding)addTree(x,z);
    }

    const pedestrians:Pedestrian[]=[];
    const alertCanvas=document.createElement("canvas");alertCanvas.width=alertCanvas.height=64;
    const alertContext=alertCanvas.getContext("2d")!;
    alertContext.font="900 54px Arial";alertContext.textAlign="center";alertContext.textBaseline="middle";
    alertContext.lineWidth=10;alertContext.strokeStyle="rgba(22,16,10,.75)";alertContext.strokeText("!",34,34);
    alertContext.fillStyle="#fff8d8";alertContext.fillText("!",32,31);
    const alertTexture=new THREE.CanvasTexture(alertCanvas);alertTexture.colorSpace=THREE.SRGBColorSpace;
    const alertMaterial=new THREE.SpriteMaterial({map:alertTexture,transparent:true,depthTest:true,depthWrite:false});
    const addPerson=(x:number,z:number,homeAxis:"x"|"z")=>{
      const g=new THREE.Group();g.position.set(x,.12,z);scene.add(g);
      // Authored at a convenient animation size, then reduced to a believable
      // ~1.7 m silhouette beside the 1.65 m civilian cars.
      const body=new THREE.Group();body.position.y=.05;body.scale.setScalar(.72);g.add(body);
      const clothing=[0x342b28,0x303b3b,0x4c342d,0x28323e][Math.floor(rng()*4)];
      const skin=[0x9b684d,0xb77d5d,0x704735][Math.floor(rng()*3)];
      box(0,1.15,0,.32,.62,.22,clothing,body);
      const head=new THREE.Mesh(sphereGeo,mat(skin));head.position.y=2;head.scale.set(.28,.32,.27);head.castShadow=true;body.add(head);
      box(0,2.24,-.02,.3,.09,.28,0x241c19,body);
      const makeLimb=(px:number,py:number,color:number,length:number)=>{
        const pivot=new THREE.Group();pivot.position.set(px,py,0);body.add(pivot);
        const limb=box(0,-length*.5,0,.115,length*.5,.12,color,pivot);limb.castShadow=true;return pivot;
      };
      const leftArm=makeLimb(-.43,1.6,clothing,.82),rightArm=makeLimb(.43,1.6,clothing,.82);
      const leftLeg=makeLimb(-.18,.58,0x252523,.9),rightLeg=makeLimb(.18,.58,0x252523,.9);
      box(0,-.92,.08,.15,.08,.28,0x171717,leftLeg);box(0,-.92,.08,.15,.08,.28,0x171717,rightLeg);
      const alert=new THREE.Sprite(alertMaterial);alert.position.set(0,2.18,0);alert.scale.set(.82,.82,1);alert.visible=false;g.add(alert);
      const target:Target={mesh:g,radius:.42,value:900,kind:"person",minSize:.72,alive:true};targets.push(target);
      const sign=rng()>.5?1:-1,direction=homeAxis==="z"?new THREE.Vector3(0,0,sign):new THREE.Vector3(sign,0,0);
      pedestrians.push({target,body,leftArm,rightArm,leftLeg,rightLeg,alert,state:rng()>.28?"walk":"idle",direction,stateUntil:performance.now()+800+rng()*2500,gait:rng()*Math.PI*2,homeAxis});
    };
    for(let i=0;i<75;i++){
      const vertical=rng()>.5,main=roadVals[Math.floor(rng()*3)],along=-78+rng()*156,side=(rng()>.5?1:-1)*(9.6+rng()*2);
      addPerson(vertical?main+side:along,vertical?along:main+side,vertical?"z":"x");
    }

    const player=new THREE.Group(); scene.add(player);
    const wormMass=new THREE.Group(); player.add(wormMass);
    const wormColors=[0x651a1b,0x7b2220,0x8f2d25,0x4d1016,0x9c382a];
    const parasiteStrands:{mesh:THREE.Mesh;phase:number;amplitude:number}[]=[];
    const makeRibbon=(curve:THREE.CatmullRomCurve3,width:number,color:number,samples=26)=>{
      const positions:number[]=[], uvs:number[]=[], indices:number[]=[];
      for(let j=0;j<=samples;j++){
        const t=j/samples, p=curve.getPoint(t);
        const radial=p.clone().normalize();
        const segmentedWidth=width*(.78+.16*Math.sin(t*Math.PI*22)+.06*Math.sin(t*Math.PI*46));
        const left=p.clone().addScaledVector(radial,-segmentedWidth);
        const right=p.clone().addScaledVector(radial,segmentedWidth);
        positions.push(left.x,left.y,left.z,right.x,right.y,right.z);
        uvs.push(0,t*8,1,t*8);
        if(j<samples){const n=j*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}
      }
      const geometry=new THREE.BufferGeometry();
      geometry.setAttribute("position",new THREE.Float32BufferAttribute(positions,3));
      geometry.setAttribute("uv",new THREE.Float32BufferAttribute(uvs,2));
      geometry.setIndex(indices); geometry.computeVertexNormals();
      const material=new THREE.MeshStandardMaterial({map:meatTexture,roughnessMap:meatTexture,bumpMap:meatTexture,bumpScale:.16,color:new THREE.Color(color).lerp(new THREE.Color(0xffffff),.35),roughness:.92,metalness:0,emissive:0x210204,emissiveIntensity:.08,flatShading:true,side:THREE.DoubleSide});
      const ribbon=new THREE.Mesh(geometry,material); ribbon.castShadow=true;
      ribbon.userData.baseRibbonPositions=new Float32Array(positions);
      return ribbon;
    };
    // Every ribbon orbits an empty core in a different uniformly distributed plane.
    for(let i=0;i<30;i++){
      const z=1-2*(i+.5)/30, azimuth=i*2.399963+rng()*.35;
      const normal=new THREE.Vector3(Math.cos(azimuth)*Math.sqrt(1-z*z),z,Math.sin(azimuth)*Math.sqrt(1-z*z)).normalize();
      const reference=Math.abs(normal.y)<.88?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
      const axisU=new THREE.Vector3().crossVectors(normal,reference).normalize();
      const axisV=new THREE.Vector3().crossVectors(normal,axisU).normalize();
      const points:THREE.Vector3[]=[];
      const phase=rng()*Math.PI*2, radius=.78+rng()*.48, turns=.9+rng()*1.35, pointCount=12;
      for(let j=0;j<pointCount;j++){
        const t=j/(pointCount-1), angle=phase+t*Math.PI*2*turns;
        const r=radius*(.9+.1*Math.sin(angle*3+i));
        const p=axisU.clone().multiplyScalar(Math.cos(angle)*r).addScaledVector(axisV,Math.sin(angle)*r);
        p.addScaledVector(normal,(rng()-.5)*.22+Math.sin(t*Math.PI*4+i)*.08);
        points.push(p);
      }
      const ribbon=makeRibbon(new THREE.CatmullRomCurve3(points),.07+rng()*.15,wormColors[i%wormColors.length]);
      wormMass.add(ribbon); parasiteStrands.push({mesh:ribbon,phase:rng()*Math.PI*2,amplitude:.018+rng()*.032});
    }
    // Loose ribbon ends remain outside the knot without plugging its hollow center.
    for(let i=0;i<12;i++){
      const z=1-2*(i+.5)/12, a=i*2.399963, direction=new THREE.Vector3(Math.cos(a)*Math.sqrt(1-z*z),z,Math.sin(a)*Math.sqrt(1-z*z));
      const side=new THREE.Vector3(-direction.z,.2,direction.x).normalize();
      const curve=new THREE.CatmullRomCurve3([
        direction.clone().multiplyScalar(.86),
        direction.clone().multiplyScalar(1.18).addScaledVector(side,.18),
        direction.clone().multiplyScalar(1.65+rng()*.55).addScaledVector(side,(rng()-.5)*.55),
      ]);
      const ribbon=makeRibbon(curve,.055+rng()*.13,wormColors[(i+2)%wormColors.length],12);
      wormMass.add(ribbon); parasiteStrands.push({mesh:ribbon,phase:rng()*Math.PI*2,amplitude:.09+rng()*.12});
    }
    type HuntingTentacle={mesh:THREE.Mesh;direction:THREE.Vector3;side:THREE.Vector3;phase:number;length:number;target:Target|null;extension:number};
    const huntingTentacles:HuntingTentacle[]=[];
    for(let i=0;i<10;i++){
      const segments=10, positions=new Float32Array((segments+1)*2*3),uvs=new Float32Array((segments+1)*2*2),indices:number[]=[];
      for(let j=0;j<=segments;j++){uvs[j*4]=0;uvs[j*4+1]=j/2;uvs[j*4+2]=1;uvs[j*4+3]=j/2;}
      for(let j=0;j<segments;j++){const n=j*2;indices.push(n,n+2,n+1,n+1,n+2,n+3);}
      const geometry=new THREE.BufferGeometry(); geometry.setAttribute("position",new THREE.BufferAttribute(positions,3));geometry.setAttribute("uv",new THREE.BufferAttribute(uvs,2)); geometry.setIndex(indices);
      const material=new THREE.MeshStandardMaterial({map:meatTexture,roughnessMap:meatTexture,bumpMap:meatTexture,bumpScale:.18,color:new THREE.Color(wormColors[(i+1)%wormColors.length]).lerp(new THREE.Color(0xffffff),.35),roughness:.94,emissive:0x210204,emissiveIntensity:.08,flatShading:true,side:THREE.DoubleSide});
      const mesh=new THREE.Mesh(geometry,material); mesh.castShadow=true; wormMass.add(mesh);
      const z=1-2*(i+.5)/10,a=i*2.399963+rng()*.4,direction=new THREE.Vector3(Math.cos(a)*Math.sqrt(1-z*z),z,Math.sin(a)*Math.sqrt(1-z*z)).normalize();
      const side=new THREE.Vector3().crossVectors(direction,Math.abs(direction.y)<.8?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0)).normalize();
      huntingTentacles.push({mesh,direction,side,phase:rng()*Math.PI*2,length:1.3+rng()*1.5,target:null,extension:0});
    }
    player.position.set(-54,1.1,-70);
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(2,24),new THREE.MeshBasicMaterial({color:0x1b0d0b,transparent:true,opacity:.35,depthWrite:false})); shadow.rotation.x=-Math.PI/2; shadow.position.y=-1; player.add(shadow);

    type Responder={mesh:THREE.Group;target:Target;kind:"police"|"swat"|"firefighter";source:VehicleAgent;side:number;cooldown:number;ammo:number;maxAmmo:number;reloadUntil:number;reloadDuration:number;weapon?:THREE.Group;rightArm?:THREE.Group;leftArm?:THREE.Group;hose?:THREE.Line};
    type Wreck={group:THREE.Group;scorch:THREE.Mesh;flames:THREE.Sprite[];smoke:THREE.Sprite[];life:number;maxLife:number};
    const responders:Responder[]=[],wrecks:Wreck[]=[],tracers:{line:THREE.Line;life:number}[]=[],skidMarks:{mesh:THREE.Mesh;born:number}[]=[],evacuees:{mesh:THREE.Group;direction:THREE.Vector3;gait:number}[]=[];
    let nextPoliceDispatch=4500,nextFireDispatch=7000;
    const spawnPerson=(vehicle:VehicleAgent,kind:Responder["kind"],side:number)=>{
      const g=new THREE.Group();g.position.copy(vehicle.mesh.position).add(new THREE.Vector3(0,0,side*1.5));scene.add(g);
      box(0,.85,0,.42,1.05,.34,kind==="firefighter"?0xd7a52b:kind==="swat"?0x101415:0x294c68,g);
      const head=new THREE.Mesh(sphereGeo,mat(kind==="swat"?0x171a1b:0xc78d68));head.scale.setScalar(.24);head.position.y=1.55;g.add(head);
      if(kind==="police"){
        const crown=new THREE.Mesh(cylGeo,mat(0x213c52));crown.scale.set(.27,.12,.27);crown.position.y=1.79;g.add(crown);box(0,1.77,-.13,.42,.055,.28,0x1b3245,g);
        box(0,1.1,.19,.26,.24,.05,0xc5ab63,g); // badge
      }else if(kind==="swat"){
        const helmet=new THREE.Mesh(new THREE.SphereGeometry(.3,8,5,0,Math.PI*2,0,Math.PI*.62),mat(0x090c0d));helmet.position.y=1.66;g.add(helmet);box(0,1.52,-.22,.34,.17,.08,0x202a2c,g);
      }
      const target:Target={mesh:g,radius:.45,height:1.85,value:kind==="swat"?1800:1200,kind:"person",minSize:.72,alive:true};targets.push(target);
      const maxAmmo=kind==="swat"?30:kind==="police"?12:0;
      const responder:Responder={mesh:g,target,kind,source:vehicle,side,cooldown:rng(),ammo:maxAmmo,maxAmmo,reloadUntil:0,reloadDuration:kind==="swat"?2100:1500};
      if(kind!=="firefighter"){
        const rightArm=new THREE.Group(),leftArm=new THREE.Group(),weapon=new THREE.Group();rightArm.position.set(-.27,1.22,0);leftArm.position.set(.27,1.22,0);g.add(rightArm,leftArm,weapon);
        box(0,-.24,.12,.13,.54,.14,kind==="swat"?0x0c0f10:0x294c68,rightArm);box(0,-.24,.12,.13,.54,.14,kind==="swat"?0x0c0f10:0x294c68,leftArm);
        weapon.position.set(0,1.13,-.38);box(0,0,0,kind==="swat"?.15:.11,.13,kind==="swat"?1.25:.62,0x111516,weapon);
        if(kind==="swat"){box(0,-.14,.03,.12,.3,.2,0x0b0d0e,weapon);box(0,.08,-.43,.1,.18,.34,0x202729,weapon);}else box(0,-.12,.08,.1,.28,.18,0x171919,weapon);
        rightArm.rotation.x=-1.05;leftArm.rotation.x=-.9;responder.weapon=weapon;responder.rightArm=rightArm;responder.leftArm=leftArm;
      }
      if(kind==="firefighter"){
        const geometry=new THREE.BufferGeometry().setFromPoints([vehicle.mesh.position.clone(),g.position.clone()]);
        const hose=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:0x342d22}));scene.add(hose);responder.hose=hose;
      }
      responders.push(responder);
    };
    const spawnEmergency=(kind:"police"|"swat"|"fire")=>{
      const edge=rng()>.5?1:-1,vertical=rng()>.5;
      const lane=(rng()>.5?1:-1)*4.2,road=roadVals[Math.floor(rng()*roadVals.length)];
      const x=vertical?road+lane:edge*96,z=vertical?edge*96:road+lane;
      const mesh=kind==="fire"?addFireTruck(x,z,vertical?0:Math.PI/2):addPoliceCar(x,z,vertical?0:Math.PI/2);
      // Dispatches exist for navigation immediately, but cannot render over the
      // empty world beyond the authored city boundary.
      mesh.visible=false;mesh.userData.waitingForCityEntry=true;
      const direction=(-edge) as 1|-1,heading=vertical?(direction>0?Math.PI/2:-Math.PI/2):(direction>0?0:Math.PI),maxSpeed=kind==="fire"?12.5:kind==="swat"?14:15;
      vehicleAgents.push({mesh,kind,axis:vertical?"z":"x",direction,speed:0,maxSpeed,acceleration:kind==="fire"?2.3:3.5,heading,targetHeading:heading,state:"road",crewDeployed:false,turnCooldown:0,brakeSpeed:0,reverseTimer:0});
    };
    const steerOffRoad=(agent:{mesh:THREE.Group;targetHeading:number},destination:THREE.Vector3)=>{
      const desired=destination.clone().sub(agent.mesh.position);desired.y=0;if(!desired.lengthSq())return;
      desired.normalize();
      for(const obstacle of targets){
        if(!obstacle.alive||obstacle.mesh===agent.mesh||obstacle.kind==="fragment")continue;
        const delta=agent.mesh.position.clone().sub(obstacle.mesh.position);delta.y=0;const range=obstacle.radius+3;
        if(delta.lengthSq()<range*range&&delta.dot(desired)<.5)desired.addScaledVector(delta.normalize(),1.8);
      }
      desired.normalize();agent.targetHeading=Math.atan2(desired.z,desired.x);
    };

    const BASE_RADIUS=1.38;
    const velocity=new THREE.Vector3();
    const keys=new Set<string>(); let active=false, finished=false, startAt=0, last=performance.now(), score=0, people=0, combo=1, destroyed=0, radius=BASE_RADIUS, comboAt=0;
    let cameraYaw=Math.PI/4, dragging=false, dragX=0;
    const debris:{mesh:THREE.Mesh;vel:THREE.Vector3;spin:THREE.Vector3;life:number;bloody?:boolean;lastTrail?:THREE.Vector3}[]=[];
    const explosions:{
      sprites:{mesh:THREE.Sprite;velocity:THREE.Vector3;age:number;life:number;start:number;end:number;smoke:boolean}[];
      sparks:{mesh:THREE.Mesh;velocity:THREE.Vector3;age:number;life:number}[];
      ring:THREE.Mesh;light:THREE.PointLight;age:number;life:number;
    }[]=[];
    let explosionShake=0;
    const treeChunks:{mesh:THREE.Mesh;vel:THREE.Vector3;spin:THREE.Vector3;born:number;stage:number}[]=[];
    const bloodPools:{mesh:THREE.Mesh;born:number;radius:number}[]=[];
    const bloodDrops:{mesh:THREE.Mesh;born:number;source:"debris"|"trail"}[]=[];const bloodDropGeometry=new THREE.PlaneGeometry(.16,.16);
    const bloodDropMaterials=[0x6f0710,0x981018,0xc32227].map(color=>new THREE.MeshBasicMaterial({color,transparent:true,opacity:.9,depthWrite:false,side:THREE.DoubleSide}));
    const bodyBlood:{mesh:THREE.Mesh;born:number;life:number}[]=[];
    let bloodLoad=0,lastBloodPickup=0;const lastBloodPrint=player.position.clone();
    const onKey=(e:KeyboardEvent)=>{
      if(e.key==="Enter"){
        e.preventDefault();
        if(!e.repeat){
          if(finished)gameRef.current.restart();
          else if(!active)gameRef.current.start();
        }
        return;
      }
      if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"," "].includes(e.key))e.preventDefault();
      keys.add(e.key.toLowerCase());
    };
    const offKey=(e:KeyboardEvent)=>keys.delete(e.key.toLowerCase()); window.addEventListener("keydown",onKey);window.addEventListener("keyup",offKey);
    const onPointerDown=(e:PointerEvent)=>{dragging=true;dragX=e.clientX;renderer.domElement.setPointerCapture(e.pointerId);renderer.domElement.style.cursor="grabbing";};
    const onPointerMove=(e:PointerEvent)=>{if(!dragging)return;cameraYaw-=THREE.MathUtils.clamp(e.clientX-dragX,-80,80)*.008;dragX=e.clientX;};
    const onPointerUp=(e:PointerEvent)=>{dragging=false;renderer.domElement.releasePointerCapture(e.pointerId);renderer.domElement.style.cursor="grab";};
    renderer.domElement.addEventListener("pointerdown",onPointerDown);
    renderer.domElement.addEventListener("pointermove",onPointerMove);
    renderer.domElement.addEventListener("pointerup",onPointerUp);
    renderer.domElement.addEventListener("pointercancel",onPointerUp);

    const shatter=(t:Target)=>{ const p=t.mesh.position.clone(); for(let i=0;i<Math.min(12,5+Math.floor(t.radius));i++){ const m=new THREE.Mesh(boxGeo,mat(i%3===0?0x3a3b39:0x77746b)); const s=.3+rng()*.65;m.scale.set(s,s*.7,s);m.position.copy(p).add(new THREE.Vector3((rng()-.5)*t.radius,1+rng()*3,(rng()-.5)*t.radius));scene.add(m);debris.push({mesh:m,vel:new THREE.Vector3((rng()-.5)*8,3+rng()*6,(rng()-.5)*8),spin:new THREE.Vector3((rng()-.5)*8,(rng()-.5)*8,(rng()-.5)*8),life:2+rng()}); } };
    const growParasiteMass=(consumed:number)=>{
      // Each consumed organism adds a new independently wound parasite to the outer shell.
      const normal=new THREE.Vector3(rng()-.5,rng()-.5,rng()-.5).normalize();
      const reference=Math.abs(normal.y)<.85?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);
      const axisU=new THREE.Vector3().crossVectors(normal,reference).normalize(),axisV=new THREE.Vector3().crossVectors(normal,axisU).normalize();
      const shellRadius=.92+Math.min(2.3,consumed*.034),phase=rng()*Math.PI*2,points:THREE.Vector3[]=[];
      for(let j=0;j<11;j++){
        const t=j/10,angle=phase+t*Math.PI*2*(.8+rng()*.75),r=shellRadius*(.88+rng()*.18);
        points.push(axisU.clone().multiplyScalar(Math.cos(angle)*r).addScaledVector(axisV,Math.sin(angle)*r).addScaledVector(normal,(rng()-.5)*.25));
      }
      const ribbon=makeRibbon(new THREE.CatmullRomCurve3(points),.055+rng()*.105,wormColors[consumed%wormColors.length],18);
      wormMass.add(ribbon);parasiteStrands.push({mesh:ribbon,phase:rng()*Math.PI*2,amplitude:.06+rng()*.12});
      // Existing parasites thicken gradually, capped at 150% of their authored width.
      const widthFactor=1+Math.min(.5,consumed*.012);
      for(const strand of parasiteStrands){
        const attribute=strand.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        const base=strand.mesh.userData.baseRibbonPositions as Float32Array|undefined;if(!base)continue;
        for(let i=0;i<attribute.count;i+=2){
          const ax=base[i*3],ay=base[i*3+1],az=base[i*3+2],bx=base[(i+1)*3],by=base[(i+1)*3+1],bz=base[(i+1)*3+2];
          const cx=(ax+bx)/2,cy=(ay+by)/2,cz=(az+bz)/2;
          attribute.setXYZ(i,cx+(ax-cx)*widthFactor,cy+(ay-cy)*widthFactor,cz+(az-cz)*widthFactor);
          attribute.setXYZ(i+1,cx+(bx-cx)*widthFactor,cy+(by-cy)*widthFactor,cz+(bz-cz)*widthFactor);
        }
        attribute.needsUpdate=true;strand.mesh.geometry.computeVertexNormals();
      }
    };
    const explodeCar=(car:Target)=>{
      const position=car.mesh.position.clone();position.y=.65;
      const sprites:{mesh:THREE.Sprite;velocity:THREE.Vector3;age:number;life:number;start:number;end:number;smoke:boolean}[]=[];
      const sparks:{mesh:THREE.Mesh;velocity:THREE.Vector3;age:number;life:number}[]=[];
      // Layered additive fireballs give the blast a hot white core, orange shell and rolling smoke.
      for(let i=0;i<22;i++){
        const smoke=i>=12,material=(smoke?explosionSmokeBases:explosionFireBases)[i%3].clone();
        const sprite=new THREE.Sprite(material),angle=rng()*Math.PI*2,distance=smoke?.35+rng()*1.2:rng()*.75;
        sprite.position.copy(position).add(new THREE.Vector3(Math.cos(angle)*distance,.1+rng()*.8,Math.sin(angle)*distance));
        const start=smoke?.7+rng()*.8:.65+rng()*.75,end=smoke?3.2+rng()*2:2.5+rng()*2;
        sprite.scale.setScalar(start);scene.add(sprite);
        sprites.push({mesh:sprite,velocity:new THREE.Vector3((rng()-.5)*(smoke?1.8:5),smoke?1.2+rng()*2.4:1.5+rng()*4,(rng()-.5)*(smoke?1.8:5)),age:0,life:smoke?1.5+rng()*1.5:.35+rng()*.45,start,end,smoke});
      }
      const sparkMaterial=new THREE.MeshBasicMaterial({color:0xffc14b,transparent:true});
      for(let i=0;i<28;i++){
        const spark=new THREE.Mesh(explosionSparkGeometry,sparkMaterial);
        spark.scale.z=.55+rng();
        spark.position.copy(position).add(new THREE.Vector3((rng()-.5)*1.2,.3+rng(),(rng()-.5)*1.2));
        spark.rotation.set(rng()*Math.PI,rng()*Math.PI,rng()*Math.PI);scene.add(spark);
        const velocity=new THREE.Vector3(rng()-.5,.2+rng()*.8,rng()-.5).normalize().multiplyScalar(5+rng()*11);
        sparks.push({mesh:spark,velocity,age:0,life:.45+rng()*.9});
      }
      // Recognisable body panels and wheels are thrown clear of the crushed vehicle.
      for(let i=0;i<9;i++){
        const wheel=i>=6,piece=new THREE.Mesh(wheel?cylGeo:boxGeo,mat(wheel?0x141516:[0x393d3e,0x8d3029,0xc0b84c][i%3]));
        piece.position.copy(position).add(new THREE.Vector3((rng()-.5)*2,.25+rng(),(rng()-.5)*1.3));
        piece.scale.set(wheel?.3:.35+rng()*.6,wheel?.18:.08+rng()*.22,wheel?.3:.3+rng()*.55);piece.castShadow=true;scene.add(piece);
        debris.push({mesh:piece,vel:new THREE.Vector3((rng()-.5)*12,4+rng()*8,(rng()-.5)*12),spin:new THREE.Vector3((rng()-.5)*14,(rng()-.5)*14,(rng()-.5)*14),life:5+rng()*3});
      }
      // Soft, asymmetric burn stain: deliberately neither a circle nor a rectangle.
      const scorchShape=new THREE.Shape();
      for(let i=0;i<18;i++){const a=i/18*Math.PI*2,r=(i%3===0?.72:1)*(2.3+rng()*.85),x=Math.cos(a)*r*1.35,y=Math.sin(a)*r*.72;i?scorchShape.lineTo(x,y):scorchShape.moveTo(x,y);}
      scorchShape.closePath();
      const scorch=new THREE.Mesh(new THREE.ShapeGeometry(scorchShape),new THREE.MeshBasicMaterial({color:0x100e0c,transparent:true,opacity:.64,depthWrite:false}));
      scorch.rotation.x=-Math.PI/2;scorch.rotation.z=rng()*Math.PI;scorch.position.set(position.x,.18,position.z);scene.add(scorch);
      const wreck=new THREE.Group();wreck.position.set(position.x,.36,position.z);wreck.rotation.y=car.mesh.rotation.y+(rng()-.5)*.3;scene.add(wreck);
      box(0,0,0,2.8,.25,1.35,0x17191a,wreck);box(.15,.22,0,1.65,.18,1.12,0x242322,wreck);
      for(let i=0;i<5;i++){const dent=box((rng()-.5)*2.3,.3+rng()*.16,(rng()-.5)*.9,.35+rng()*.7,.08+rng()*.18,.25+rng()*.5,i%2?0x0c0d0d:0x302824,wreck);dent.rotation.y=rng()*Math.PI;}
      wreck.scale.y=.58;
      const lingeringFlames:THREE.Sprite[]=[],lingeringSmoke:THREE.Sprite[]=[];
      for(let i=0;i<9;i++){
        const smoke=i>=4,material=(smoke?explosionSmokeBases:explosionFireBases)[i%3].clone(),sprite=new THREE.Sprite(material);
        sprite.position.set(position.x+(rng()-.5)*1.8,.65+rng()*1.2,position.z+(rng()-.5)*1);sprite.scale.setScalar(smoke?1.5:1);scene.add(sprite);(smoke?lingeringSmoke:lingeringFlames).push(sprite);
      }
      wrecks.push({group:wreck,scorch,flames:lingeringFlames,smoke:lingeringSmoke,life:24,maxLife:24});
      const ring=new THREE.Mesh(explosionRingGeometry,new THREE.MeshBasicMaterial({color:0xffb52f,transparent:true,opacity:.85,side:THREE.DoubleSide,depthWrite:false,blending:THREE.AdditiveBlending}));
      ring.rotation.x=-Math.PI/2;ring.position.set(position.x,.24,position.z);scene.add(ring);
      const light=new THREE.PointLight(0xff721c,18,18,2);light.position.copy(position).setY(2);scene.add(light);
      explosions.push({sprites,sparks,ring,light,age:0,life:3});explosionShake=Math.min(1.4,explosionShake+.85);
    };
    const deployCrashOccupants=(agent:VehicleAgent)=>{
      if(agent.crewDeployed)return;agent.crewDeployed=true;
      if(agent.kind!=="civilian"){
        const crewKind=agent.kind==="fire"?"firefighter":agent.kind==="swat"?"swat":"police";spawnPerson(agent,crewKind,-1);spawnPerson(agent,crewKind,1);return;
      }
      for(const side of [-1,1]){
        const g=new THREE.Group();g.position.copy(agent.mesh.position).add(new THREE.Vector3(0,.05,side*1.35));scene.add(g);
        box(0,.8,0,.38,1,.32,[0x81705c,0x4b6981,0x8b493f][Math.floor(rng()*3)],g);const head=new THREE.Mesh(sphereGeo,mat(0xc78d68));head.scale.setScalar(.23);head.position.y=1.48;g.add(head);
        const direction=g.position.clone().sub(player.position).setY(0).normalize();evacuees.push({mesh:g,direction,gait:rng()*Math.PI*2});
      }
    };
    const igniteCrash=(agent:VehicleAgent,impact:THREE.Vector3)=>{
      if(agent.state==="crashed"||!agent.mesh.parent)return;agent.state="crashed";agent.brakeSpeed=agent.speed;agent.speed=0;deployCrashOccupants(agent);
      const smokeMaterial=explosionSmokeBases[0].clone(),flameMaterial=explosionFireBases[1].clone();
      const smoke=new THREE.Sprite(smokeMaterial),flame=new THREE.Sprite(flameMaterial);const localImpact=impact.clone().sub(agent.mesh.position).setY(.55);
      smoke.position.copy(localImpact);flame.position.copy(localImpact);smoke.scale.setScalar(.25);flame.scale.setScalar(.08);agent.mesh.add(smoke,flame);agent.crash={age:0,smoke,flame};
    };
    const collect=(t:Target)=>{ t.alive=false; score+=Math.round(t.value*combo); combo=Math.min(99,combo+1); comboAt=performance.now(); if(t.kind==="person"){people++;growParasiteMass(people);}if(t.kind==="car")explodeCar(t);if(t.kind==="building"){destroyed++;shatter(t);t.mesh.scale.y=.08;t.mesh.position.y=-.5;}else{scene.remove(t.mesh);} if(t.kind==="person")radius=Math.min(6.8,radius+.038); };
    const crushPerson=(t:Target,impactDirection:THREE.Vector3,impactForce:number)=>{
      if(!t.alive)return;t.alive=false;const position=t.mesh.position.clone();scene.remove(t.mesh);
      score+=Math.round(t.value*combo);combo=Math.min(99,combo+1);comboAt=performance.now();people++;growParasiteMass(people);radius=Math.min(6.8,radius+.038);
      impactDirection.y=0;if(!impactDirection.lengthSq())impactDirection.set(1,0,0);impactDirection.normalize();
      const lateral=new THREE.Vector3(-impactDirection.z,0,impactDirection.x);
      const fragmentCount=5+Math.floor(rng()*6);
      for(let i=0;i<fragmentCount;i++){
        const fragment=new THREE.Mesh(i%3===0?sphereGeo:boxGeo,mat([0x7d171b,0xa12b29,0xc46b51,0x421012][i%4]));
        fragment.position.copy(position).add(new THREE.Vector3((rng()-.5)*.45,.35+rng()*.9,(rng()-.5)*.45));
        fragment.scale.set(.12+rng()*.24,.1+rng()*.28,.12+rng()*.25);fragment.castShadow=true;scene.add(fragment);
        const fragmentVelocity=impactDirection.clone().multiplyScalar(impactForce*(.55+rng()*.8)).addScaledVector(lateral,(rng()-.5)*impactForce*.75);fragmentVelocity.y=1.5+rng()*impactForce*.55;
        debris.push({mesh:fragment,vel:fragmentVelocity,spin:new THREE.Vector3((rng()-.5)*10,(rng()-.5)*10,(rng()-.5)*10),life:30,bloody:true,lastTrail:position.clone()});
        targets.push({mesh:fragment,radius:.28,height:.35,value:0,kind:"fragment",minSize:0,alive:true});
      }
      const splatterCount=2+Math.floor(rng()*2);
      for(let i=0;i<splatterCount;i++){
        const canvas=document.createElement("canvas");canvas.width=canvas.height=128;const context=canvas.getContext("2d")!;
        const colors=["#4c0308","#6d080e","#8e1117","#a91b20"];
        // Several dense islands form connected stains; distant single pixels form the spray.
        const clusters=3+Math.floor(rng()*4);
        for(let c=0;c<clusters;c++){
          const cx=44+rng()*62,cy=37+rng()*54,clusterRadius=8+rng()*25,drops=18+Math.floor(rng()*28);
          for(let d=0;d<drops;d++){
            const angle=rng()*Math.PI*2,distance=Math.pow(rng(),1.7)*clusterRadius;
            const size=d<drops*.3?4+Math.floor(rng()*9):1+Math.floor(rng()*5);
            context.fillStyle=colors[Math.floor(rng()*colors.length)];
            context.fillRect(Math.round(cx+Math.cos(angle)*distance),Math.round(cy+Math.sin(angle)*distance),size,size*(rng()>.72?2:1));
          }
        }
        for(let d=0;d<55;d++){
          const angle=(rng()-.5)*1.35,distance=28+Math.pow(rng(),.55)*48,size=rng()>.84?3:1+Math.floor(rng()*2);
          context.fillStyle=colors[Math.floor(rng()*colors.length)];
          context.fillRect(Math.round(64+Math.cos(angle)*distance),Math.round(64+Math.sin(angle)*distance),size,size);
        }
        const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;
        const pool=new THREE.Mesh(new THREE.PlaneGeometry(5.5+rng()*3.5,5.5+rng()*3.5),new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:.82,depthWrite:false,side:THREE.DoubleSide}));
        pool.rotation.x=-Math.PI/2;pool.rotation.z=-Math.atan2(impactDirection.z,impactDirection.x)+(rng()-.5)*.22;
        const sprayDistance=impactForce*.12*(.5+rng());pool.position.set(position.x+impactDirection.x*sprayDistance,.17+i*.003,position.z+impactDirection.z*sprayDistance);scene.add(pool);bloodPools.push({mesh:pool,born:performance.now(),radius:3.1});
      }
      while(bloodPools.length>90){const old=bloodPools.shift()!.mesh;scene.remove(old);old.geometry.dispose();const material=old.material as THREE.MeshBasicMaterial;material.map?.dispose();material.dispose();}
    };
    const fractureTree=(tree:Target)=>{
      if(!tree.alive||tree.kind!=="tree")return;tree.alive=false;const position=tree.mesh.position.clone(),born=performance.now();scene.remove(tree.mesh);
      const count=4+Math.floor(rng()*3);
      for(let i=0;i<count;i++){
        const wood=i<2,chunk=new THREE.Mesh(wood?boxGeo:new THREE.IcosahedronGeometry(1,0),mat(wood?0x493426:[0x354b35,0x586043,0x72513a][i%3]));
        chunk.position.copy(position).add(new THREE.Vector3((rng()-.5)*1.5,.6+rng()*2.4,(rng()-.5)*1.5));
        const size=wood?.45+rng()*.5:.75+rng()*.8;chunk.scale.set(size*(wood?.55:1),size*(wood?1.7:1),size*(wood?.55:1));chunk.castShadow=true;scene.add(chunk);
        treeChunks.push({mesh:chunk,vel:new THREE.Vector3((rng()-.5)*6,2+rng()*4,(rng()-.5)*6),spin:new THREE.Vector3((rng()-.5)*6,(rng()-.5)*6,(rng()-.5)*6),born,stage:0});
      }
      score+=1800*combo;combo=Math.min(99,combo+1);comboAt=performance.now();
    };
    const absorbFragment=(fragment:Target)=>{
      if(!fragment.alive)return;fragment.alive=false;scene.remove(fragment.mesh);
      const physics=debris.find(item=>item.mesh===fragment.mesh);if(physics)physics.life=0;
    };

    const restart=()=>{ location.reload(); };
    renderer.compile(scene,camera);
    scene.remove(explosionWarmup);
    gameRef.current={start:()=>{active=true;finished=false;startAt=performance.now();setStarted(true);},restart};
    let performanceFrames=0,performanceSampleAt=performance.now(),lampCullAt=0;
    const viewProjection=new THREE.Matrix4(),viewFrustum=new THREE.Frustum();
    function animate(now:number){ requestAnimationFrame(animate); const dt=Math.min(.035,(now-last)/1000);last=now; const elapsed=active?(now-startAt)/1000:0; const remain=Math.max(0,90-elapsed);
      // One match travels from morning through noon and sunset into a visibly
      // dark final quarter, when the complete street-light network switches on.
      const dayProgress=THREE.MathUtils.clamp(elapsed/90,0,1),phaseT=dayProgress<.5?dayProgress*2:(dayProgress-.5)*2;
      if(dayProgress<.5){
        phaseSky.lerpColors(morningSky,noonSky,phaseT);phaseSun.lerpColors(morningSun,noonSun,phaseT);phaseHemi.lerpColors(morningHemi,noonHemi,phaseT);
      }else if(dayProgress<.76){
        const sunsetT=(dayProgress-.5)/.26;
        phaseSky.lerpColors(noonSky,eveningSky,sunsetT);phaseSun.lerpColors(noonSun,eveningSun,sunsetT);phaseHemi.lerpColors(noonHemi,eveningHemi,sunsetT);
      }else{
        const nightT=(dayProgress-.76)/.24;
        phaseSky.lerpColors(eveningSky,nightSky,nightT);phaseSun.lerpColors(eveningSun,nightSun,nightT);phaseHemi.lerpColors(eveningHemi,nightHemi,nightT);
      }
      (scene.background as THREE.Color).copy(phaseSky).multiplyScalar(1-rainStrength*.12);
      scene.fog!.color.copy(phaseSky).multiplyScalar(.94-rainStrength*.08);
      sun.color.copy(phaseSun);hemi.color.copy(phaseHemi);
      hemi.groundColor.set(dayProgress>.62?0x493b38:0x3f4840);
      const nightFactor=THREE.MathUtils.smoothstep(dayProgress,.7,.82);
      const daylight=(dayProgress<.5?THREE.MathUtils.lerp(2.75,3.9,phaseT):THREE.MathUtils.lerp(3.9,.78,(dayProgress-.5)*2))*(1-nightFactor*.15);
      hemi.intensity=(dayProgress<.5?THREE.MathUtils.lerp(2.25,3.05,phaseT):THREE.MathUtils.lerp(3.05,.92,(dayProgress-.5)*2))*(1-rainStrength*.12);
      lampGlow.emissiveIntensity=nightFactor*5.5;
      lampGlow.color.setRGB(.43+.57*nightFactor,.41+.39*nightFactor,.3+.12*nightFactor);
      // Most of the illumination is a feathered radial pool. The atmospheric
      // cone remains only a faint hint, so its polygon edge never reads as a wall.
      lampBeamMaterial.opacity=nightFactor*(.018+rainStrength*.016);
      lampPoolMaterial.opacity=nightFactor*(.52+rainStrength*.16);
      // Three already frustum-culls opaque meshes. Transparent lamp effects need
      // an explicit fixture-level visibility pass because their large bounds can
      // otherwise survive well outside the useful view.
      if(now-lampCullAt>250){
        lampCullAt=now;camera.updateMatrixWorld();viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);viewFrustum.setFromProjectionMatrix(viewProjection);
        const candidates:{fixture:(typeof lampFixtures)[number];distance:number}[]=[];
        for(const fixture of lampFixtures){
          const visible=nightFactor>.015&&viewFrustum.containsPoint(fixture.position)&&fixture.position.distanceToSquared(camera.position)<10500;
          fixture.beam.visible=visible;fixture.groundPool.visible=visible;
          if(visible)candidates.push({fixture,distance:fixture.position.distanceToSquared(player.position)});
        }
        candidates.sort((a,b)=>a.distance-b.distance);
        for(let i=0;i<lampPools.length;i++){
          const candidate=candidates[i];lampPools[i].visible=!!candidate;
          if(candidate)lampPools[i].position.copy(candidate.fixture.position);
        }
      }
      for(const pool of lampPools)pool.intensity=nightFactor*(2.2+rainStrength*.8);
      sun.position.x=THREE.MathUtils.lerp(-62,48,dayProgress);sun.position.z=THREE.MathUtils.lerp(26,-38,dayProgress);
      if(now>=weatherChangeAt){
        raining=!raining;
        // Dry spells vary more than storms, so weather never settles into a fixed rhythm.
        weatherChangeAt=now+(raining?8+weatherRandom()*14:11+weatherRandom()*22)*1000;
      }
      rainStrength=THREE.MathUtils.lerp(rainStrength,raining?1:0,1-Math.pow(raining?.025:.08,dt));
      roadWetness=THREE.MathUtils.clamp(roadWetness+(raining?.085:-.012)*dt,0,1);
      rainMaterial.opacity=rainStrength*.62;
      roadMaterial.color.lerpColors(dryRoadColor,wetRoadColor,roadWetness*.12);
      roadMaterial.roughness=.98;roadMaterial.metalness=0;
      for(const wetPatchMaterial of wetPatchMaterials){wetPatchMaterial.opacity=.08+roadWetness*.46;wetPatchMaterial.roughness=.74-roadWetness*.18;}
      scene.fog!.density=.0045+rainStrength*.0018;sun.intensity=daylight*(1-rainStrength*.34);
      const rainAttribute=rainGeometry.getAttribute("position") as THREE.BufferAttribute;
      for(let i=0;i<rainCount;i++){
        const n=i*2;let x=rainAttribute.getX(n),y=rainAttribute.getY(n),z=rainAttribute.getZ(n);
        y-=dt*(30+weatherRandom()*16)*Math.max(.25,rainStrength);x-=dt*(4.2+rainStrength*2.5);z+=dt*1.7;
        if(y<.2||Math.abs(x-player.position.x)>58||Math.abs(z-player.position.z)>58){
          x=player.position.x+(weatherRandom()-.5)*110;y=22+weatherRandom()*42;z=player.position.z+(weatherRandom()-.5)*110;
        }
        const length=.7+weatherRandom()*2.1;rainAttribute.setXYZ(n,x,y,z);rainAttribute.setXYZ(n+1,x-.18,y-length,z+.08);
      }
      rainAttribute.needsUpdate=true;
      const flash=Math.floor(now/170)%2===0, sirenPulse=.88+Math.sin(now*.028)*.12;
      for(const lights of policeLights){
        lights.red.emissiveIntensity=flash?5:.2; lights.blue.emissiveIntensity=flash?.2:5;
        lights.redGlow.opacity=flash?.95:.08; lights.blueGlow.opacity=flash?.08:.95;
        lights.redPoint.intensity=flash?5:0; lights.bluePoint.intensity=flash?0:5;
        const activeScale=5.2+sirenPulse*1.4, inactiveScale=3.2;
        lights.redSprite.scale.setScalar(flash?activeScale:inactiveScale);
        lights.blueSprite.scale.setScalar(flash?inactiveScale:activeScale);
      }
      if(active){
        const sinceStart=now-startAt;
        if(sinceStart>nextPoliceDispatch){spawnEmergency(rng()>.72?"swat":"police");nextPoliceDispatch=sinceStart+9000+rng()*6000;}
        if(sinceStart>nextFireDispatch&&vehicleAgents.filter(v=>v.kind==="fire"&&v.mesh.parent).length<3){spawnEmergency("fire");nextFireDispatch=sinceStart+11000+rng()*7000;}
      }
      // Shared navigation: every vehicle follows its lane direction normally;
      // only explicit danger/pursuit states enter the obstacle-aware free-space solver.
      for(const agent of vehicleAgents){
        if(!agent.mesh.parent)continue;
        if(agent.mesh.userData.waitingForCityEntry&&Math.abs(agent.mesh.position.x)<=82&&Math.abs(agent.mesh.position.z)<=82){agent.mesh.visible=true;agent.mesh.userData.waitingForCityEntry=false;}
        agent.turnCooldown=Math.max(0,agent.turnCooldown-dt);
        const distToThreat=agent.mesh.position.distanceTo(player.position),previousState=agent.state;
        if(agent.kind==="civilian"&&active&&distToThreat<11+radius*1.5){
          if(agent.state!=="flee"){const towardThreat=player.position.clone().sub(agent.mesh.position).setY(0).normalize().dot(new THREE.Vector3(Math.cos(agent.heading),0,Math.sin(agent.heading)));if(distToThreat<8+radius&&towardThreat>.25)agent.reverseTimer=1.15;}
          agent.state="flee";
        }
        if((agent.kind==="police"||agent.kind==="swat")&&agent.state==="road"&&distToThreat<28)agent.state="pursue";
        if(agent.kind==="fire"){
          const fire=wrecks.filter(w=>w.life>0).sort((a,b)=>a.group.position.distanceToSquared(agent.mesh.position)-b.group.position.distanceToSquared(agent.mesh.position))[0];agent.target=fire?.group.position;
          if(fire&&agent.mesh.position.distanceTo(fire.group.position)<10)agent.state="parked";
        }
        if(agent.state==="road"){
          const goal=agent.kind==="fire"&&agent.target?agent.target:player.position;
          const coordinate=agent.axis==="x"?agent.mesh.position.x:agent.mesh.position.z;
          const atIntersection=roadVals.some(v=>Math.abs(coordinate-v)<.55);
          if(atIntersection&&agent.kind!=="civilian"&&agent.turnCooldown<=0){
            const otherAxis=agent.axis==="x"?"z":"x",difference=otherAxis==="x"?goal.x-agent.mesh.position.x:goal.z-agent.mesh.position.z;
            if(Math.abs(difference)>10){agent.axis=otherAxis;agent.direction=(difference>=0?1:-1);agent.turnCooldown=1.15;}
          }
          agent.targetHeading=agent.axis==="x"?(agent.direction>0?0:Math.PI):(agent.direction>0?Math.PI/2:-Math.PI/2);
        }else if(agent.state==="flee"){
          const escape=agent.mesh.position.clone().sub(player.position).setY(0).normalize().multiplyScalar(45).add(agent.mesh.position);steerOffRoad(agent,escape);
        }else if(agent.state==="pursue"){
          if(distToThreat>7+radius)steerOffRoad(agent,player.position);else agent.state="parked";
        }
        const wantsStop=agent.state==="parked"||agent.state==="crashed";
        if(wantsStop&&previousState!==agent.state)agent.brakeSpeed=agent.speed;
        const targetSpeed=wantsStop?0:agent.maxSpeed;
        const rate=targetSpeed>agent.speed?agent.acceleration:(agent.state==="parked"?12:6.5);
        agent.speed=THREE.MathUtils.damp(agent.speed,targetSpeed,rate/Math.max(1,targetSpeed),dt);
        const angleDelta=Math.atan2(Math.sin(agent.targetHeading-agent.heading),Math.cos(agent.targetHeading-agent.heading));
        agent.heading+=THREE.MathUtils.clamp(angleDelta,-1.65*dt,1.65*dt);
        agent.mesh.rotation.y=Math.PI-agent.heading;
        agent.reverseTimer=Math.max(0,agent.reverseTimer-dt);if(agent.state!=="crashed")agent.mesh.position.add(new THREE.Vector3(Math.cos(agent.heading),0,Math.sin(agent.heading)).multiplyScalar(agent.speed*dt*(agent.reverseTimer>0?-0.62:1)));
        const braking=Math.max(0,agent.brakeSpeed-agent.speed);agent.mesh.rotation.z=THREE.MathUtils.damp(agent.mesh.rotation.z,wantsStop&&braking>.8?.09:0,9,dt);
        if(wantsStop&&agent.brakeSpeed>5&&agent.speed>1&&Math.floor(now/55)%2===0){
          const mark=new THREE.Mesh(new THREE.PlaneGeometry(.18,.75),new THREE.MeshBasicMaterial({color:0x111313,transparent:true,opacity:.62,depthWrite:false}));mark.rotation.x=-Math.PI/2;mark.rotation.z=-agent.heading+Math.PI/2;mark.position.copy(agent.mesh.position).setY(.19);scene.add(mark);skidMarks.push({mesh:mark,born:now});
        }
        if(wantsStop&&agent.speed<.3)agent.brakeSpeed=0;
        if(agent.state==="parked"&&!agent.crewDeployed){agent.crewDeployed=true;const crewKind=agent.kind==="fire"?"firefighter":agent.kind==="swat"?"swat":"police";spawnPerson(agent,crewKind,-1);spawnPerson(agent,crewKind,1);}
        if(agent.crash){
          agent.crash.age+=dt;const growth=THREE.MathUtils.clamp(agent.crash.age/4.2,0,1);agent.crash.smoke.scale.setScalar(.25+growth*2.5);agent.crash.flame.scale.setScalar(.08+growth*1.35);
          (agent.crash.smoke.material as THREE.SpriteMaterial).opacity=.25+growth*.42;(agent.crash.flame.material as THREE.SpriteMaterial).opacity=.25+growth*.7;
          if(agent.crash.age>5.2){const target=targets.find(t=>t.mesh===agent.mesh&&t.alive);if(target)collect(target);agent.crash=undefined;}
        }
      }
      // Vehicle/vehicle and vehicle/building impacts share one crash lifecycle.
      for(let i=0;i<vehicleAgents.length;i++){
        const a=vehicleAgents[i];if(!a.mesh.parent||a.state==="crashed")continue;
        for(let j=i+1;j<vehicleAgents.length;j++){const b=vehicleAgents[j];if(!b.mesh.parent||b.state==="crashed")continue;if(a.mesh.position.distanceToSquared(b.mesh.position)<13){const impact=a.mesh.position.clone().lerp(b.mesh.position,.5);igniteCrash(a,impact);igniteCrash(b,impact);}}
        for(const obstacle of targets){if(!obstacle.alive||obstacle.kind!=="building")continue;const distance=Math.hypot(a.mesh.position.x-obstacle.mesh.position.x,a.mesh.position.z-obstacle.mesh.position.z);if(distance<obstacle.radius+1.4){igniteCrash(a,a.mesh.position.clone().lerp(obstacle.mesh.position,.35));break;}}
      }
      for(const evacuee of evacuees){evacuee.gait+=dt*13;const away=evacuee.mesh.position.clone().sub(player.position).setY(0).normalize();evacuee.direction.lerp(away,.12).normalize();evacuee.mesh.position.addScaledVector(evacuee.direction,5.5*dt);evacuee.mesh.rotation.y=Math.atan2(evacuee.direction.x,evacuee.direction.z);evacuee.mesh.position.y=.05+Math.abs(Math.sin(evacuee.gait))*.08;}
      for(let i=skidMarks.length-1;i>=0;i--){const mark=skidMarks[i],age=(now-mark.born)/1000;(mark.mesh.material as THREE.MeshBasicMaterial).opacity=.62*THREE.MathUtils.clamp((18-age)/7,0,1);if(age>18){scene.remove(mark.mesh);mark.mesh.geometry.dispose();(mark.mesh.material as THREE.Material).dispose();skidMarks.splice(i,1);}}
      for(const responder of responders){
        if(!responder.target.alive||!responder.mesh.parent){if(responder.hose?.parent){scene.remove(responder.hose);responder.hose.geometry.dispose();(responder.hose.material as THREE.Material).dispose();}continue;}responder.cooldown-=dt;
        const destination=responder.kind==="firefighter"?responder.source.target:player.position;
        if(!destination)continue;const delta=destination.clone().sub(responder.mesh.position).setY(0),distance=delta.length();
        const range=responder.kind==="swat"?19:responder.kind==="police"?12:7;
        if(distance>range*.78){const temp={mesh:responder.mesh,targetHeading:0};steerOffRoad(temp,destination);const step=destination.clone().sub(responder.mesh.position).setY(0).normalize();responder.mesh.position.addScaledVector(step,(responder.kind==="firefighter"?3.2:4.2)*dt);}
        responder.mesh.rotation.y=Math.atan2(-delta.z,delta.x);
        if(responder.hose){
          const points=[responder.source.mesh.position.clone().setY(.45),responder.mesh.position.clone().setY(.35)];responder.hose.geometry.setFromPoints(points);
        }
        const reloading=responder.reloadUntil>now;
        if(responder.weapon&&responder.rightArm&&responder.leftArm){
          if(reloading){
            const remaining=(responder.reloadUntil-now)/responder.reloadDuration,phase=1-remaining;
            responder.weapon.rotation.z=Math.sin(phase*Math.PI)*.72;responder.weapon.position.y=1.13-Math.sin(phase*Math.PI)*.28;
            responder.rightArm.rotation.x=-.55-Math.sin(phase*Math.PI)*.7;responder.leftArm.rotation.x=-.45-Math.sin(phase*Math.PI)*.55;
          }else{responder.weapon.rotation.z=THREE.MathUtils.damp(responder.weapon.rotation.z,0,14,dt);responder.weapon.position.y=THREE.MathUtils.damp(responder.weapon.position.y,1.13,14,dt);responder.rightArm.rotation.x=THREE.MathUtils.damp(responder.rightArm.rotation.x,-1.05,14,dt);responder.leftArm.rotation.x=THREE.MathUtils.damp(responder.leftArm.rotation.x,-.9,14,dt);}
        }
        if(distance<range&&responder.cooldown<=0&&!reloading){
          if(responder.kind==="firefighter"){
            responder.cooldown=.09;const victim=wrecks.find(w=>w.group.position.distanceTo(destination)<1);if(victim)victim.life-=.11;
          }else if(responder.ammo<=0){
            responder.reloadUntil=now+responder.reloadDuration;responder.ammo=responder.maxAmmo;responder.cooldown=responder.reloadDuration/1000;
          }else{
            responder.cooldown=responder.kind==="swat"?.11:.68;responder.ammo--;
            if(responder.weapon)responder.weapon.rotation.x=-.08;
            const geometry=new THREE.BufferGeometry().setFromPoints([responder.mesh.position.clone().setY(1.12),player.position.clone().setY(radius*.7)]);
            const line=new THREE.Line(geometry,new THREE.LineBasicMaterial({color:responder.kind==="swat"?0xffd56a:0xffecac,transparent:true,opacity:.9}));scene.add(line);tracers.push({line,life:.07});
          }
        }
      }
      for(let i=tracers.length-1;i>=0;i--){tracers[i].life-=dt;if(tracers[i].life<=0){scene.remove(tracers[i].line);tracers[i].line.geometry.dispose();(tracers[i].line.material as THREE.Material).dispose();tracers.splice(i,1);}}
      for(let i=wrecks.length-1;i>=0;i--){
        const wreck=wrecks[i];wreck.life-=dt;const decay=THREE.MathUtils.clamp(wreck.life/wreck.maxLife,0,1);
        wreck.group.scale.set(1,.58,1).multiplyScalar(.72+.28*decay);(wreck.scorch.material as THREE.MeshBasicMaterial).opacity=.64*Math.min(1,decay*3);
        for(const flame of wreck.flames){flame.scale.setScalar((.25+.9*rng())*decay);(flame.material as THREE.SpriteMaterial).opacity=.85*decay;}
        for(const smoke of wreck.smoke){smoke.position.y+=dt*(.35+.5*decay);smoke.scale.setScalar((1.2+rng())*decay);(smoke.material as THREE.SpriteMaterial).opacity=.48*decay;}
        if(wreck.life<=0){scene.remove(wreck.group,wreck.scorch);wreck.scorch.geometry.dispose();(wreck.scorch.material as THREE.Material).dispose();for(const particle of [...wreck.flames,...wreck.smoke]){scene.remove(particle);(particle.material as THREE.Material).dispose();}wrecks.splice(i,1);}
      }
      // Inner ribbons twitch subtly while exposed outer parasites wriggle much more.
      for(const strand of parasiteStrands){
        strand.mesh.rotation.x=Math.sin(now*.0017+strand.phase)*strand.amplitude;
        strand.mesh.rotation.z=Math.cos(now*.0021+strand.phase*1.7)*strand.amplitude;
      }
      // Pedestrians stroll, pause, notice the approaching mass, then flee in
      // the opposite direction. The warning only remains during the reaction beat.
      for(const pedestrian of pedestrians){
        if(!pedestrian.target.alive)continue;
        const person=pedestrian.target.mesh;
        const away=person.position.clone().sub(player.position);away.y=0;
        const distance=away.length();
        if(active&&pedestrian.state!=="run"&&pedestrian.state!=="alert"&&distance<12+radius*1.35){
          pedestrian.state="alert";pedestrian.stateUntil=now+620;pedestrian.alert.visible=true;
        }
        if(pedestrian.state==="alert"&&now>=pedestrian.stateUntil){
          pedestrian.state="run";pedestrian.alert.visible=false;
          pedestrian.direction.copy(away.lengthSq()>.001?away.normalize():new THREE.Vector3(1,0,0));
        }else if((pedestrian.state==="idle"||pedestrian.state==="walk")&&now>=pedestrian.stateUntil){
          if(pedestrian.state==="idle"){
            pedestrian.state="walk";pedestrian.direction.multiplyScalar(rng()>.18?1:-1);pedestrian.stateUntil=now+1800+rng()*3600;
          }else{
            pedestrian.state="idle";pedestrian.stateUntil=now+650+rng()*2200;
          }
        }
        let speed=0,amplitude=0;
        if(pedestrian.state==="walk"){speed=1.05;amplitude=.48;}
        if(pedestrian.state==="run"){
          if(distance>0.01)pedestrian.direction.lerp(away.normalize(),1-Math.pow(.035,dt)).normalize();
          speed=5.5;amplitude=.92;
        }
        if(speed){
          person.position.addScaledVector(pedestrian.direction,speed*dt);
          pedestrian.gait+=dt*(pedestrian.state==="run"?13:6.2);
          person.rotation.y=Math.atan2(pedestrian.direction.x,pedestrian.direction.z);
        }
        // Turn strolling pedestrians around at the map edge; panicked people
        // are clamped but continue trying to get away from the danger.
        if(Math.abs(person.position.x)>80){person.position.x=THREE.MathUtils.clamp(person.position.x,-80,80);if(pedestrian.state!=="run")pedestrian.direction.x*=-1;}
        if(Math.abs(person.position.z)>80){person.position.z=THREE.MathUtils.clamp(person.position.z,-80,80);if(pedestrian.state!=="run")pedestrian.direction.z*=-1;}
        const stride=Math.sin(pedestrian.gait)*amplitude;
        pedestrian.leftLeg.rotation.x=stride;pedestrian.rightLeg.rotation.x=-stride;
        pedestrian.leftArm.rotation.x=-stride*.82;pedestrian.rightArm.rotation.x=stride*.82;
        pedestrian.body.position.y=.05+(speed?Math.abs(Math.sin(pedestrian.gait*2))*(pedestrian.state==="run"?.11:.035):0);
        pedestrian.body.rotation.x=pedestrian.state==="run"?.16:0;
        if(pedestrian.state==="alert"){
          const shakeX=Math.sin(now*.105+pedestrian.gait)*.18,shakeY=Math.cos(now*.137+pedestrian.gait)*.09;
          pedestrian.alert.position.set(shakeX,2.18+shakeY,0);
          pedestrian.alert.material.rotation=Math.sin(now*.13)*.13;
          pedestrian.body.rotation.z=Math.sin(now*.045+pedestrian.gait)*.035;
        }else{
          pedestrian.alert.visible=false;pedestrian.body.rotation.z=0;
        }
      }
      // Free parasites search independently. Nearby living prey triggers a sudden snake-like strike.
      for(let ti=0;ti<huntingTentacles.length;ti++){
        const tentacle=huntingTentacles[ti];
        if(tentacle.target&&!tentacle.target.alive)tentacle.target=null;
        if(!tentacle.target&&active&&Math.floor(now/350+ti)%7===0){
          let nearest:Target|null=null, nearestDistance=9+radius*2;
          for(const candidate of targets){
            if(!candidate.alive||(candidate.kind!=="person"&&candidate.kind!=="fragment"))continue;
            const assigned=huntingTentacles.reduce((count,other)=>count+(other.target===candidate?1:0),0);
            if(assigned>=(candidate.kind==="person"?3:1))continue;
            const distance=candidate.mesh.position.distanceTo(player.position);
            if(distance<nearestDistance){nearest=candidate;nearestDistance=distance;}
          }
          tentacle.target=nearest;
        }
        tentacle.extension=THREE.MathUtils.lerp(tentacle.extension,tentacle.target?1:0,1-Math.pow(tentacle.target ? .006 : .045,dt));
        const start=tentacle.direction.clone().multiplyScalar(.72);
        let end=tentacle.direction.clone().multiplyScalar(tentacle.length*(1+.16*Math.sin(now*.002+tentacle.phase)));
        if(tentacle.target){
          end=wormMass.worldToLocal(tentacle.target.mesh.position.clone());
          if(end.length()>12)tentacle.target=null;
        }
        const attribute=tentacle.mesh.geometry.getAttribute("position") as THREE.BufferAttribute;
        const segments=10; let tipCenter=start.clone();
        for(let j=0;j<=segments;j++){
          const t=j/segments, eased=t*t*(3-2*t);
          const idleEnd=tentacle.direction.clone().multiplyScalar(tentacle.length);
          const soughtEnd=idleEnd.lerp(end,tentacle.extension);
          let center=start.clone().lerp(soughtEnd,eased);
          const wave=Math.sin(t*Math.PI*3-now*.006+tentacle.phase)*(.16+.2*t)*(1-t*.35);
          center.addScaledVector(tentacle.side,wave);
          // Resolve every rope segment against the ground and large scene colliders.
          const worldCenter=wormMass.localToWorld(center.clone());
          worldCenter.y=Math.max(.12,worldCenter.y);
          for(const obstacle of targets){
            if(!obstacle.alive||obstacle.kind==="person")continue;
            const height=obstacle.height??(obstacle.kind==="building"?18:obstacle.kind==="tree"?5:2);
            if(worldCenter.y>height)continue;
            const dx=worldCenter.x-obstacle.mesh.position.x,dz=worldCenter.z-obstacle.mesh.position.z;
            const colliderRadius=obstacle.kind==="tree"&&worldCenter.y<height*.68?(obstacle.baseRadius??.5):obstacle.radius*.72;
            const minimum=colliderRadius+.08, distance=Math.hypot(dx,dz);
            if(distance<minimum){
              if(active&&obstacle.kind==="tree"&&j>segments*.55){fractureTree(obstacle);continue;}
              const nx=distance>.001?dx/distance:tentacle.side.x,nz=distance>.001?dz/distance:tentacle.side.z;
              worldCenter.x=obstacle.mesh.position.x+nx*minimum;worldCenter.z=obstacle.mesh.position.z+nz*minimum;
            }
          }
          center=wormMass.worldToLocal(worldCenter); if(j===segments)tipCenter=center.clone();
          const width=(.13*(1-t)+.045)*(1+.22*Math.sin(t*Math.PI*10))*(1+Math.min(.5,people*.012));
          attribute.setXYZ(j*2,center.x-tentacle.side.x*width,center.y-tentacle.side.y*width,center.z-tentacle.side.z*width);
          attribute.setXYZ(j*2+1,center.x+tentacle.side.x*width,center.y+tentacle.side.y*width,center.z+tentacle.side.z*width);
        }
        attribute.needsUpdate=true; tentacle.mesh.geometry.computeVertexNormals();
        if(tentacle.target&&tentacle.extension>.92&&tipCenter.distanceTo(end)<1.1){
          const prey=tentacle.target;tentacle.target=null;
          if(prey.kind==="fragment")absorbFragment(prey);
          else {
            const impactDirection=prey.mesh.position.clone().sub(player.position);
            const impactForce=THREE.MathUtils.clamp(4+impactDirection.length()*.55+velocity.length()*.22,4.5,12);
            crushPerson(prey,impactDirection,impactForce);
          }
        }
      }
      if(active&&!finished){
        const inputRight=(keys.has("d")||keys.has("arrowright")?1:0)-(keys.has("a")||keys.has("arrowleft")?1:0);
        const inputForward=(keys.has("w")||keys.has("arrowup")?1:0)-(keys.has("s")||keys.has("arrowdown")?1:0);
        const viewForward=new THREE.Vector3(-Math.sin(cameraYaw),0,-Math.cos(cameraYaw));
        const viewRight=new THREE.Vector3(Math.cos(cameraYaw),0,-Math.sin(cameraYaw));
        const move=viewForward.multiplyScalar(inputForward).addScaledVector(viewRight,inputRight);
        const mass=1+people*.11, maximumSpeed=(keys.has("shift")?15:10.5)/Math.pow(mass,.12);
        if(move.lengthSq()){move.normalize();velocity.addScaledVector(move,24/Math.sqrt(mass)*dt);}
        else {const speed=velocity.length(),braking=10/Math.pow(mass,.38)*dt;if(speed>0)velocity.multiplyScalar(Math.max(0,(speed-braking)/speed));}
        velocity.multiplyScalar(Math.pow(.78,dt)); if(velocity.length()>maximumSpeed)velocity.setLength(maximumSpeed);
        const displacement=velocity.clone().multiplyScalar(dt); player.position.add(displacement);
        if(displacement.lengthSq()){wormMass.rotation.z-=displacement.x/radius;wormMass.rotation.x+=displacement.z/radius;}
        player.position.y=radius*.62; player.scale.setScalar(1);shadow.scale.setScalar(radius/BASE_RADIUS);
        // Rolling through an existing pool transfers several wet stains onto the mass.
        let touchedBlood=false;
        for(const stain of bloodPools)if(Math.hypot(player.position.x-stain.mesh.position.x,player.position.z-stain.mesh.position.z)<radius+stain.radius*.62){touchedBlood=true;break;}
        if(!touchedBlood)for(const stain of bloodDrops)if(stain.source==="debris"&&Math.hypot(player.position.x-stain.mesh.position.x,player.position.z-stain.mesh.position.z)<radius+.35){touchedBlood=true;break;}
        if(touchedBlood&&now-lastBloodPickup>240){
          lastBloodPickup=now;bloodLoad=Math.min(1,bloodLoad+.22);
          for(let i=0;i<2;i++){
            const normal=new THREE.Vector3(rng()-.5,rng()-.25,rng()-.5).normalize();
            const material=new THREE.MeshBasicMaterial({color:[0x651018,0x8b171b,0xb12a25][Math.floor(rng()*3)],transparent:true,opacity:.82,depthWrite:false});
            const stain=new THREE.Mesh(sphereGeo,material);stain.position.copy(normal).multiplyScalar(.95+rng()*.12);
            stain.scale.set(.18+rng()*.28,.025,.12+rng()*.22);stain.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),normal);wormMass.add(stain);
            bodyBlood.push({mesh:stain,born:now,life:8+rng()*5});
          }
          while(bodyBlood.length>28){const old=bodyBlood.shift()!;wormMass.remove(old.mesh);(old.mesh.material as THREE.Material).dispose();}
        }
        // Wet blood prints back onto the road while the creature rolls, then gradually runs out.
        const printDistance=Math.hypot(player.position.x-lastBloodPrint.x,player.position.z-lastBloodPrint.z);
        if(bloodLoad>.045&&printDistance>Math.max(.38,radius*.22)&&velocity.length()>.8){
          const count=1+(bloodLoad>.55?1:0);
          for(let i=0;i<count;i++){
            const material=bloodDropMaterials[Math.floor(rng()*bloodDropMaterials.length)].clone();material.opacity=.32+bloodLoad*.5;
            const drop=new THREE.Mesh(bloodDropGeometry,material);drop.rotation.x=-Math.PI/2;drop.rotation.z=rng()*Math.PI;
            drop.scale.set((1.4+rng()*3.2)*(1+radius*.12),(.7+rng()*1.7)*(1+radius*.08),1);
            drop.position.set(player.position.x+(rng()-.5)*radius*.7,.205+rng()*.004,player.position.z+(rng()-.5)*radius*.7);
            scene.add(drop);bloodDrops.push({mesh:drop,born:now,source:"trail"});
          }
          lastBloodPrint.copy(player.position);bloodLoad=Math.max(0,bloodLoad-.018);
        }
        for(const t of targets){
          if(!t.alive||t.kind==="fragment")continue;const dx=player.position.x-t.mesh.position.x,dz=player.position.z-t.mesh.position.z;
          const contact=radius+t.radius*.55,distance=Math.hypot(dx,dz);
          if(distance<contact){
            if(t.kind==="tree"){fractureTree(t);velocity.multiplyScalar(.82);}
            else if(radius>=t.minSize)collect(t);
            else if(t.kind!=="person"){
              const nx=distance>.001?dx/distance:1,nz=distance>.001?dz/distance:0;
              player.position.x=t.mesh.position.x+nx*contact;player.position.z=t.mesh.position.z+nz*contact;
              const inward=velocity.x*nx+velocity.z*nz;if(inward<0){velocity.x-=inward*1.5*nx;velocity.z-=inward*1.5*nz;}
            }
          }
        }
        if(player.position.x<=-82||player.position.x>=82)velocity.x=0;if(player.position.z<=-82||player.position.z>=82)velocity.z=0;
        player.position.x=THREE.MathUtils.clamp(player.position.x,-82,82);player.position.z=THREE.MathUtils.clamp(player.position.z,-82,82);
        if(now-comboAt>2300)combo=1;
        if(remain<=0){finished=true;active=false;setEnded(true);}
        setHud({score,people,combo,size:radius/BASE_RADIUS,time:Math.ceil(remain),destroyed});
      }
      for(let i=debris.length-1;i>=0;i--){
        const d=debris[i];d.life-=dt;d.vel.y-=12*dt;d.mesh.position.addScaledVector(d.vel,dt);
        d.mesh.rotation.x+=d.spin.x*dt;d.mesh.rotation.y+=d.spin.y*dt;d.mesh.rotation.z+=d.spin.z*dt;
        if(d.mesh.position.y<.2){
          d.mesh.position.y=.2;d.vel.x*=.58;d.vel.z*=.58;d.vel.y=Math.abs(d.vel.y)*.22;d.spin.multiplyScalar(.58);
          if(d.bloody&&d.lastTrail&&Math.hypot(d.mesh.position.x-d.lastTrail.x,d.mesh.position.z-d.lastTrail.z)>.07&&Math.hypot(d.vel.x,d.vel.z)>.06){
            const trailStart=d.lastTrail.clone(),trailDistance=Math.hypot(d.mesh.position.x-trailStart.x,d.mesh.position.z-trailStart.z);
            const dropCount=1+Math.min(3,Math.floor(trailDistance/.13));
            for(let n=1;n<=dropCount;n++){
              const t=n/dropCount,drop=new THREE.Mesh(bloodDropGeometry,bloodDropMaterials[Math.floor(rng()*bloodDropMaterials.length)]);
              drop.rotation.x=-Math.PI/2;drop.rotation.z=rng()*Math.PI;drop.scale.set(.75+rng()*2.2,.5+rng()*1.25,1);
              drop.position.set(THREE.MathUtils.lerp(trailStart.x,d.mesh.position.x,t)+(rng()-.5)*.14,.21+rng()*.004,THREE.MathUtils.lerp(trailStart.z,d.mesh.position.z,t)+(rng()-.5)*.14);
              scene.add(drop);bloodDrops.push({mesh:drop,born:now,source:"debris"});if(bloodDrops.length>650){const old=bloodDrops.shift()!;scene.remove(old.mesh);if(old.mesh.material!==bloodDropMaterials[0]&&old.mesh.material!==bloodDropMaterials[1]&&old.mesh.material!==bloodDropMaterials[2])(old.mesh.material as THREE.Material).dispose();}
            }
            d.lastTrail.copy(d.mesh.position);
          }
          if(Math.hypot(d.vel.x,d.vel.z)<.08){d.vel.x=d.vel.z=0;d.spin.set(0,0,0);}
          if(d.vel.y<.12)d.vel.y=0;
        }
        if(d.life<0){const fragment=targets.find(target=>target.kind==="fragment"&&target.mesh===d.mesh);if(fragment)fragment.alive=false;scene.remove(d.mesh);debris.splice(i,1);}
      }
      for(let i=explosions.length-1;i>=0;i--){
        const explosion=explosions[i];explosion.age+=dt;
        for(const particle of explosion.sprites){
          particle.age+=dt;particle.mesh.position.addScaledVector(particle.velocity,dt);
          particle.velocity.multiplyScalar(particle.smoke?Math.pow(.55,dt):Math.pow(.18,dt));
          const progress=Math.min(1,particle.age/particle.life),size=THREE.MathUtils.lerp(particle.start,particle.end,particle.smoke?Math.sqrt(progress):Math.sin(progress*Math.PI)*.7+progress);
          particle.mesh.scale.setScalar(size);
          (particle.mesh.material as THREE.SpriteMaterial).opacity=(particle.smoke?.58:.95)*Math.pow(1-progress,particle.smoke?1.25:2.2);
        }
        for(const spark of explosion.sparks){
          spark.age+=dt;spark.velocity.y-=10*dt;spark.mesh.position.addScaledVector(spark.velocity,dt);
          spark.mesh.lookAt(spark.mesh.position.clone().add(spark.velocity));
          (spark.mesh.material as THREE.MeshBasicMaterial).opacity=Math.max(0,1-spark.age/spark.life);
        }
        const ringProgress=Math.min(1,explosion.age/.65);explosion.ring.scale.setScalar(1+ringProgress*8);
        (explosion.ring.material as THREE.MeshBasicMaterial).opacity=.85*Math.pow(1-ringProgress,2);
        explosion.light.intensity=18*Math.pow(Math.max(0,1-explosion.age/.55),2);
        if(explosion.age>=explosion.life){
          for(const particle of explosion.sprites){scene.remove(particle.mesh);(particle.mesh.material as THREE.Material).dispose();}
          for(const spark of explosion.sparks)scene.remove(spark.mesh);
          if(explosion.sparks[0])(explosion.sparks[0].mesh.material as THREE.Material).dispose();
          scene.remove(explosion.ring,explosion.light);(explosion.ring.material as THREE.Material).dispose();explosions.splice(i,1);
        }
      }
      explosionShake=Math.max(0,explosionShake-dt*2.2);
      for(let i=treeChunks.length-1;i>=0;i--){
        const chunk=treeChunks[i],age=(now-chunk.born)/1000;chunk.vel.y-=12*dt;chunk.mesh.position.addScaledVector(chunk.vel,dt);
        chunk.mesh.rotation.x+=chunk.spin.x*dt;chunk.mesh.rotation.y+=chunk.spin.y*dt;chunk.mesh.rotation.z+=chunk.spin.z*dt;
        if(chunk.mesh.position.y<.2){chunk.mesh.position.y=.2;chunk.vel.x*=.58;chunk.vel.z*=.58;chunk.vel.y=Math.abs(chunk.vel.y)*.18;chunk.spin.multiplyScalar(.55);if(Math.hypot(chunk.vel.x,chunk.vel.z)<.06){chunk.vel.x=chunk.vel.z=0;chunk.spin.set(0,0,0);}}
        const wantedStage=Math.min(2,Math.floor(age/10));
        if(wantedStage>chunk.stage){
          chunk.stage=wantedStage;chunk.mesh.scale.multiplyScalar(.58);
          const child=chunk.mesh.clone();child.position.copy(chunk.mesh.position).add(new THREE.Vector3((rng()-.5)*.5,.25,(rng()-.5)*.5));child.scale.multiplyScalar(.72);scene.add(child);
          treeChunks.push({mesh:child,vel:new THREE.Vector3((rng()-.5)*2,1+rng()*2,(rng()-.5)*2),spin:new THREE.Vector3((rng()-.5)*4,(rng()-.5)*4,(rng()-.5)*4),born:chunk.born,stage:chunk.stage});
        }
        if(age>=30){scene.remove(chunk.mesh);treeChunks.splice(i,1);}
      }
      // Body stains last roughly 8–13 seconds; road stains persist much longer.
      bloodLoad=Math.max(0,bloodLoad-dt*.035);
      for(let i=bodyBlood.length-1;i>=0;i--){
        const stain=bodyBlood[i],age=(now-stain.born)/1000,fade=THREE.MathUtils.clamp((stain.life-age)/2,0,1);
        (stain.mesh.material as THREE.MeshBasicMaterial).opacity=.82*fade;
        if(age>=stain.life){wormMass.remove(stain.mesh);(stain.mesh.material as THREE.Material).dispose();bodyBlood.splice(i,1);}
      }
      for(let i=bloodPools.length-1;i>=0;i--){
        const stain=bloodPools[i],age=(now-stain.born)/1000,material=stain.mesh.material as THREE.MeshBasicMaterial;
        material.opacity=.82*THREE.MathUtils.clamp((82-age)/16,0,1);
        if(age>=82){scene.remove(stain.mesh);stain.mesh.geometry.dispose();material.map?.dispose();material.dispose();bloodPools.splice(i,1);}
      }
      for(let i=bloodDrops.length-1;i>=0;i--){
        const stain=bloodDrops[i],age=(now-stain.born)/1000,life=stain.source==="trail"?48:62,material=stain.mesh.material as THREE.MeshBasicMaterial;
        material.opacity=Math.min(material.opacity,THREE.MathUtils.clamp((life-age)/12,0,1)*.9);
        if(age>=life){scene.remove(stain.mesh);if(!bloodDropMaterials.includes(material))material.dispose();bloodDrops.splice(i,1);}
      }
      const cameraDistance=54+radius*.8;
      const desired=new THREE.Vector3(player.position.x+Math.sin(cameraYaw)*cameraDistance,48+radius*1.5,player.position.z+Math.cos(cameraYaw)*cameraDistance);camera.position.lerp(desired,1-Math.pow(.001,dt));camera.lookAt(player.position.x,0,player.position.z);
      const pulse=1+Math.sin(now*.006)*.018;wormMass.scale.setScalar(pulse);
      if(explosionShake>0){camera.position.x+=(rng()-.5)*explosionShake;camera.position.y+=(rng()-.5)*explosionShake*.55;camera.position.z+=(rng()-.5)*explosionShake;}
      renderer.info.reset();
      renderer.setRenderTarget(renderTarget);renderer.render(scene,camera);renderer.setRenderTarget(null);renderer.render(postScene,postCamera);
      performanceFrames++;
      if(now-performanceSampleAt>=500&&performanceRef.current){
        let modelCount=0;
        scene.traverse(object=>{if((object as THREE.Mesh).isMesh&&object.visible)modelCount++;});
        const fps=Math.round(performanceFrames*1000/(now-performanceSampleAt));
        performanceRef.current.innerHTML=`<span>模型 <b>${modelCount.toLocaleString()}</b></span><span>面 <b>${renderer.info.render.triangles.toLocaleString()}</b></span><span>FPS <b>${fps}</b></span>`;
        performanceFrames=0;performanceSampleAt=now;
      }
    }
    requestAnimationFrame(animate);
    const resize=()=>{camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);renderer.getDrawingBufferSize(drawingSize);renderTarget.setSize(drawingSize.x,drawingSize.y);postMaterial.uniforms.resolution.value.copy(drawingSize);};window.addEventListener("resize",resize);
    return()=>{window.removeEventListener("resize",resize);window.removeEventListener("keydown",onKey);window.removeEventListener("keyup",offKey);renderer.domElement.removeEventListener("pointerdown",onPointerDown);renderer.domElement.removeEventListener("pointermove",onPointerMove);renderer.domElement.removeEventListener("pointerup",onPointerUp);renderer.domElement.removeEventListener("pointercancel",onPointerUp);renderTarget.dispose();postMaterial.dispose();renderer.dispose();host.removeChild(renderer.domElement);};
  },[]);

  return <main className="game-shell">
    <div ref={mount} className="viewport" aria-label="城市破坏游戏画面" />
    <header className="topbar"><div><span className="eyebrow">CITY DESTRUCTION</span><strong>{hud.destroyed}<small> BUILDINGS</small></strong></div><div className="rage"><span>RAGE</span><i><b style={{width:`${Math.min(100,hud.combo*6)}%`}}/></i></div><div className="timer">{String(Math.floor(hud.time/60)).padStart(2,"0")}:{String(hud.time%60).padStart(2,"0")}</div></header>
    <section className="broadcast"><span className="live">LIVE</span><div><small>ESTIMATED DAMAGE</small><strong>${hud.score.toLocaleString()}</strong></div><div><small>HUMAN CASUALTIES</small><strong>{hud.people}</strong></div><div className="ticker">LATEST DEVELOPMENT <b>LOCAL POLICE INVESTIGATING</b></div><div ref={performanceRef} className="performance"><span>模型 <b>—</b></span><span>面 <b>—</b></span><span>FPS <b>—</b></span></div></section>
    {started&&!ended&&<div className="combo" key={hud.combo}>{hud.combo>2&&<>COMBO <b>×{hud.combo}</b></>}</div>}
    {!started&&!ended&&<section className="menu"><p className="kicker">A CITY HAS 90 SECONDS LEFT</p><h1>TYPHOON<br/><em>TERROR</em></h1><p>吞噬街道，撕碎城市。越大，就能摧毁越大的目标。</p><button onClick={()=>gameRef.current.start()}>开始灾难 <span>ENTER</span></button><div className="controls"><span><kbd>WASD</kbd> 移动</span><span><kbd>SHIFT</kbd> 冲刺</span><span><kbd>鼠标拖动</kbd> 旋转视角</span></div></section>}
    {ended&&<section className="menu result"><p className="kicker">90 SECONDS OF TOTAL CHAOS</p><h2>CITY REPORT</h2><div className="stats"><span>损失金额<b>${hud.score.toLocaleString()}</b></span><span>建筑摧毁<b>{hud.destroyed}</b></span><span>最大体积<b>{hud.size.toFixed(1)}×</b></span></div><button onClick={()=>gameRef.current.restart()}>再次破坏</button></section>}
    {started&&!ended&&<aside className="mission"><small>CURRENT OBJECTIVE</small><b>{hud.size<2.2?"吞噬生物，成长至 2.2×":hud.destroyed<3?"摧毁 3 栋建筑":"造成 $1,000,000 损失"}</b><div><i style={{width:`${hud.size<2.2?Math.min(100,hud.size/2.2*100):hud.destroyed<3?hud.destroyed/3*100:Math.min(100,hud.score/1000000*100)}%`}}/></div></aside>}
  </main>;
}
