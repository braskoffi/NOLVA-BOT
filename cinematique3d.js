/* NALVO : cinématique 3D du code de réduction (Three.js r128 + sons générés par WebAudio, aucun fichier son).
   window.NALVO3D({font, ac, fin}) : font = police helvetiker (JSON), ac = AudioContext (ou null), fin = appelé à la fin.
   Tous les trajets (à pied et en véhicule) sont tracés pour contourner la plateforme, les barrières, les plots et la benne. */
(function(){
"use strict";
var T=window.THREE;
function clamp(v,a,b){return v<a?a:v>b?b:v}
function hasard(a,b){return a+Math.random()*(b-a)}

/* ===================================================================== SONS (tout est synthétisé, volume général bas) */
function Sons(ac){
  var vide=function(){},NOMS=['clank','thud','boom','clatter','chime','whoosh','swish','whistle','psst','pas','stamp','tick','radio','ooh','klaxon','voiturePasse','chaine','sangle','benne','porte','bip'];
  if(!ac){var o={maj:vide,stop:vide,setCam:vide,foule:vide,applaudir:vide,diesel:vide,emetteur:function(){return{maj:vide,rpm:vide}}};NOMS.forEach(function(k){o[k]=vide});return o}
  var m=ac.createGain(),comp=ac.createDynamicsCompressor();m.gain.value=.12;m.connect(comp);comp.connect(ac.destination);
  var nb=ac.createBuffer(1,ac.sampleRate*2,ac.sampleRate),dd=nb.getChannelData(0),br=0;
  for(var i=0;i<dd.length;i++){var w=Math.random()*2-1;br=(br+.02*w)/1.02;dd[i]=i%2?w:br*3.5}
  var cam=null,V=new T.Vector3(),POSF=new T.Vector3(0,1.6,-16.5);
  function now(){return ac.currentTime}
  function placer(pos){if(!pos||!cam)return{pan:0,g:1};V.copy(pos).applyMatrix4(cam.matrixWorldInverse);var d=V.length();
    return{pan:clamp(V.x/(Math.abs(V.z)+3),-1,1)*.85,g:1/(1+d*d*.004)}}
  function sortie(pos,panFixe){var s=placer(pos),g=ac.createGain();g.gain.value=s.g;
    if(ac.createStereoPanner){var p=ac.createStereoPanner();p.pan.value=panFixe!=null?panFixe:s.pan;g.connect(p);p.connect(m)}else g.connect(m);return g}
  function env(g,t,d,peak,att){g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(peak,t+(att||.005));g.gain.exponentialRampToValueAtTime(.0001,t+d)}
  function bruit(t,d,peak,type,f0,f1,q,pos,pan){var s=ac.createBufferSource(),f=ac.createBiquadFilter(),g=ac.createGain();s.buffer=nb;s.loop=true;f.type=type;
    f.frequency.setValueAtTime(f0,t);if(f1)f.frequency.exponentialRampToValueAtTime(f1,t+d);f.Q.value=q||.7;env(g,t,d,peak);
    s.connect(f);f.connect(g);g.connect(sortie(pos,pan));s.start(t,Math.random()*1.5);s.stop(t+d+.05)}
  function ton(t,d,peak,type,f0,f1,att,pos,pan){var o=ac.createOscillator(),g=ac.createGain();o.type=type;o.frequency.setValueAtTime(f0,t);
    if(f1)o.frequency.exponentialRampToValueAtTime(f1,t+d);env(g,t,d,peak,att);o.connect(g);g.connect(sortie(pos,pan));o.start(t);o.stop(t+d+.05)}
  function osc(type,f,dest){var o=ac.createOscillator();o.type=type;o.frequency.value=f;o.connect(dest);o.start();return o}
  function boucleBruit(type,f,q,dest){var s=ac.createBufferSource(),fi=ac.createBiquadFilter();s.buffer=nb;s.loop=true;fi.type=type;fi.frequency.value=f;fi.Q.value=q||.7;s.connect(fi);fi.connect(dest);s.start();return fi}
  /* ambiance de ville (rumeur lointaine) et vent */
  var amb=ac.createGain();amb.gain.value=.55;amb.connect(m);boucleBruit('lowpass',230,.6,amb);
  var vent=ac.createGain();vent.gain.value=.08;vent.connect(m);boucleBruit('bandpass',650,.4,vent);
  /* émetteurs continus placés dans la scène : leur volume et leur côté (gauche/droite) suivent la caméra */
  function emetteur(build){var g=ac.createGain(),p=ac.createStereoPanner?ac.createStereoPanner():null;g.gain.value=0;if(p){g.connect(p);p.connect(m)}else g.connect(m);
    var e=build(g)||{};e.maj=function(pos,level){var s=placer(pos);g.gain.setTargetAtTime(level*s.g,now(),.12);if(p)p.pan.setTargetAtTime(s.pan,now(),.12)};if(!e.rpm)e.rpm=vide;return e}
  function diesel(f){return function(dest){var fi=ac.createBiquadFilter(),am=ac.createGain();fi.type='lowpass';fi.frequency.value=f*9;am.gain.value=.8;fi.connect(am);am.connect(dest);
    var o1=osc('sawtooth',f,fi),o2=osc('square',f*2.01,fi),lfo=ac.createOscillator(),lg=ac.createGain();lfo.frequency.value=f*.42;lg.gain.value=.35;lfo.connect(lg);lg.connect(am.gain);lfo.start();
    var ra=ac.createGain();ra.gain.value=.25;ra.connect(am);boucleBruit('bandpass',f*22,2,ra);
    return{rpm:function(r){o1.frequency.setTargetAtTime(f*r,now(),.3);o2.frequency.setTargetAtTime(f*2.01*r,now(),.3);lfo.frequency.setTargetAtTime(f*.42*r,now(),.3);fi.frequency.setTargetAtTime(f*9*Math.sqrt(r),now(),.3)}}}}
  function hydraulique(dest){var f=ac.createBiquadFilter();f.type='bandpass';f.frequency.value=700;f.Q.value=3;f.connect(dest);osc('sawtooth',210,f);return{}}
  /* foule : voix qui murmurent (formants qui changent comme des syllabes), « oh ! », applaudissements */
  var fouleG=ac.createGain(),fp=ac.createStereoPanner?ac.createStereoPanner():null;fouleG.gain.value=0;if(fp){fouleG.connect(fp);fp.connect(m)}else fouleG.connect(m);
  var voix=[];for(i=0;i<6;i++)(function(k){var g=ac.createGain(),b1=ac.createBiquadFilter(),b2=ac.createBiquadFilter(),p=ac.createStereoPanner?ac.createStereoPanner():null;
    b1.type=b2.type='bandpass';b1.Q.value=6;b2.Q.value=8;g.gain.value=0;var f0=(k%2?110:185)+Math.random()*50,o=osc('sawtooth',f0,b1);o.connect(b2);b1.connect(g);b2.connect(g);
    if(p){p.pan.value=(k/5-.5)*1.2;g.connect(p);p.connect(fouleG)}else g.connect(fouleG);voix.push({g:g,b1:b1,b2:b2,o:o,f0:f0,t:Math.random(),ooh:0})})(i);
  var fouleNiv=0,claps=0,oiseauT=1.5,klaxT=14;
  function majVoix(dt){voix.forEach(function(v){v.t-=dt;if(v.ooh>0){v.ooh-=dt;return}if(v.t>0)return;var parle=Math.random()<.72;v.t=parle?hasard(.07,.17):hasard(.25,1.1);
    var t=now();v.b1.frequency.setTargetAtTime(hasard(300,850),t,.02);v.b2.frequency.setTargetAtTime(hasard(950,2300),t,.02);v.o.frequency.setTargetAtTime(v.f0*hasard(.9,1.15),t,.04);
    v.g.gain.setTargetAtTime(parle?hasard(.25,.6):0,t,.025)})}
  var api={
    setCam:function(c){cam=c},emetteur:emetteur,diesel:diesel,hydraulique:hydraulique,
    foule:function(n){fouleNiv=n},applaudir:function(n){claps=n},
    ooh:function(){var t=now();voix.forEach(function(v){v.ooh=1.6;v.b1.frequency.setTargetAtTime(480,t,.05);v.b2.frequency.setTargetAtTime(820,t,.05);
      v.o.frequency.setValueAtTime(v.f0*1.25,t);v.o.frequency.linearRampToValueAtTime(v.f0*1.6,t+.35);v.o.frequency.linearRampToValueAtTime(v.f0*1.05,t+1.4);
      v.g.gain.setTargetAtTime(.9,t,.05);v.g.gain.setTargetAtTime(0,t+1.2,.15)})},
    clank:function(f,pos){var t=now();f=f||1;[820,1370,2150,3420,4800].forEach(function(x,i){ton(t,.7-.1*i,.2*f/(i+1),'sine',x*hasard(.95,1.05),x*.97,0,pos)});bruit(t,.08,.6*f,'highpass',2500,0,0,pos)},
    thud:function(f,pos){var t=now();f=f||.6;ton(t,.45,.9*f,'sine',130,40,0,pos);bruit(t,.25,.5*f,'lowpass',900,120,0,pos)},
    boom:function(pos){var t=now();ton(t,1.8,1,'sine',95,26,0,pos);bruit(t,2,1,'lowpass',3000,50,0,pos);ton(t,.9,.35,'sawtooth',62,28,0,pos)},
    clatter:function(d,pos,f){var t=now();f=f||1;for(var i=0;i<34;i++){var u=t+Math.random()*d;ton(u,.07,(.05+Math.random()*.06)*f,'square',hasard(500,2900),300,0,pos);bruit(u,.05,.12*f,'highpass',2000,0,0,pos)}},
    benne:function(pos){var t=now();for(var i=0;i<10;i++){var u=t+Math.random()*.9;ton(u,.3,.5,'sine',hasard(70,140),40,0,pos);bruit(u,.15,.35,'lowpass',hasard(600,1400),0,0,pos)}api.clatter(1.2,pos,1.3)},
    chime:function(pos){var t=now();[1568,2093,2637,3136].forEach(function(f,i){ton(t+i*.08,1.6,.2,'sine',f,f,0,pos)});bruit(t,.9,.08,'highpass',6000,0,0,pos)},
    whoosh:function(d,pos){bruit(now(),d||.8,.4,'bandpass',260,2600,.9,pos)},
    swish:function(pos){bruit(now(),.3,.26,'bandpass',1900,500,1.3,pos)},
    whistle:function(pos){var t=now();ton(t,.22,.2,'sine',2100,2700,0,pos);ton(t+.28,.5,.2,'sine',2700,1800,0,pos)},
    psst:function(pos){bruit(now(),.9,.4,'highpass',4500,1600,0,pos)},
    pas:function(pos){bruit(now(),.07,.07,'lowpass',hasard(300,520),0,0,pos)},
    stamp:function(){var t=now();ton(t,.35,.8,'sine',110,45);bruit(t,.09,.5,'bandpass',1300)},
    tick:function(pos){ton(now(),.05,.08,'square',hasard(1800,2800),1500,0,pos)},
    bip:function(pos){ton(now(),.12,.12,'square',1180,1180,0,pos)},
    radio:function(pos){var t=now();bruit(t,.18,.25,'bandpass',2400,0,3,pos);ton(t+.2,.06,.08,'sine',1400,1400,0,pos);for(var i=0;i<6;i++)bruit(t+.28+i*.09,.07,.12,'bandpass',hasard(900,2200),0,4,pos);bruit(t+.85,.15,.2,'bandpass',2400,0,3,pos)},
    klaxon:function(){var t=now(),p=hasard(-.8,.8);ton(t,.28,.035,'square',415,415,.01,null,p);ton(t,.28,.03,'square',523,523,.01,null,p)},
    voiturePasse:function(dir){var t=now(),s=ac.createBufferSource(),f=ac.createBiquadFilter(),g=ac.createGain(),p=ac.createStereoPanner?ac.createStereoPanner():null;
      s.buffer=nb;s.loop=true;f.type='bandpass';f.Q.value=.8;f.frequency.setValueAtTime(380,t);f.frequency.linearRampToValueAtTime(900,t+1.1);f.frequency.linearRampToValueAtTime(320,t+2.4);
      g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.16,t+1.1);g.gain.exponentialRampToValueAtTime(.0001,t+2.5);s.connect(f);f.connect(g);
      if(p){p.pan.setValueAtTime(-.9*dir,t);p.pan.linearRampToValueAtTime(.9*dir,t+2.4);g.connect(p);p.connect(m)}else g.connect(m);s.start(t);s.stop(t+2.6)},
    chaine:function(pos){var t=now();for(var i=0;i<7;i++)ton(t+i*.06+Math.random()*.03,.12,.06,'triangle',hasard(2400,4200),2000,0,pos)},
    sangle:function(pos){var t=now();bruit(t,.25,.25,'bandpass',1600,700,2,pos);ton(t+.2,.05,.12,'square',2600,2000,0,pos)},
    porte:function(pos){var t=now();ton(t,.5,.06,'sawtooth',190,140,.05,pos);ton(t+.5,.25,.3,'sine',120,50,0,pos)},
    maj:function(dt){if(!cam)return;
      var s=placer(POSF);fouleG.gain.setTargetAtTime(fouleNiv*clamp(s.g*3,.25,1)*.5,now(),.3);if(fp)fp.pan.setTargetAtTime(s.pan,now(),.3);
      majVoix(dt);
      var n=claps*dt*45;while(n>0){if(Math.random()<n)bruit(now()+Math.random()*.03,.03,hasard(.08,.25),'bandpass',hasard(1500,3200),0,1.1,POSF);n-=1}
      oiseauT-=dt;if(oiseauT<0){oiseauT=hasard(1.2,4.5);var t=now(),k=3+(Math.random()*5|0),f=hasard(2600,4600),p=hasard(-.9,.9);
        for(var j=0;j<k;j++)ton(t+j*hasard(.08,.14),.07,.04,'sine',f*hasard(.9,1.1),f*hasard(1.15,1.5),.01,null,p)}
      klaxT-=dt;if(klaxT<0){klaxT=hasard(10,22);api.klaxon()}},
    stop:function(){m.gain.setTargetAtTime(0,now(),.15);setTimeout(function(){try{ac.close()}catch(e){}},900)}};
  return api;
}

/* ===================================================================== TEXTURES (dessinées en canvas) */
function canvasTex(w,h,draw,rep){var c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
  var t=new T.CanvasTexture(c);t.anisotropy=4;if(rep){t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(rep[0],rep[1])}return t}
function texSol(){return canvasTex(512,512,function(x,w,h){x.fillStyle='#4a3a2c';x.fillRect(0,0,w,h);
  for(var i=0;i<11000;i++){var g=40+Math.random()*55|0;x.fillStyle='rgba('+(g+30)+','+(g+15)+','+g+','+(.15+Math.random()*.35)+')';x.fillRect(Math.random()*w,Math.random()*h,1+Math.random()*3,1+Math.random()*3)}
  for(i=0;i<50;i++){x.fillStyle='rgba(20,14,10,'+(.06+Math.random()*.12)+')';x.beginPath();x.arc(Math.random()*w,Math.random()*h,10+Math.random()*50,0,6.3);x.fill()}
  x.strokeStyle='rgba(25,18,12,.35)';x.lineWidth=7;for(i=0;i<3;i++){var y=80+i*170;x.beginPath();x.moveTo(0,y);x.bezierCurveTo(170,y+40,340,y-40,512,y);x.stroke();
    x.beginPath();x.moveTo(0,y+26);x.bezierCurveTo(170,y+66,340,y-14,512,y+26);x.stroke()}},[14,10])}
function texBeton(){return canvasTex(256,256,function(x,w,h){x.fillStyle='#6d6a72';x.fillRect(0,0,w,h);for(var i=0;i<5000;i++){var g=90+Math.random()*40|0;x.fillStyle='rgba('+g+','+g+','+(g+6)+',.35)';x.fillRect(Math.random()*w,Math.random()*h,2,2)}
  x.strokeStyle='rgba(40,38,44,.6)';x.lineWidth=2;for(i=0;i<=w;i+=64){x.beginPath();x.moveTo(i,0);x.lineTo(i,h);x.stroke();x.beginPath();x.moveTo(0,i);x.lineTo(w,i);x.stroke()}},[60,2])}
function texRoute(){return canvasTex(256,256,function(x,w,h){x.fillStyle='#25232b';x.fillRect(0,0,w,h);for(var i=0;i<7000;i++){var g=30+Math.random()*30|0;x.fillStyle='rgba('+g+','+g+','+(g+4)+',.5)';x.fillRect(Math.random()*w,Math.random()*h,2,2)}
  x.fillStyle='#d9d4c8';for(i=0;i<w;i+=64)x.fillRect(i,h/2-3,34,6)},[40,1])}
function texRayures(){return canvasTex(256,64,function(x,w,h){x.fillStyle='#f4f4f6';x.fillRect(0,0,w,h);x.fillStyle='#e11d2e';
  for(var i=-2;i<10;i++){x.beginPath();x.moveTo(i*40,h);x.lineTo(i*40+20,h);x.lineTo(i*40+44,0);x.lineTo(i*40+24,0);x.fill()}
  x.fillStyle='rgba(0,0,0,.12)';for(i=0;i<300;i++)x.fillRect(Math.random()*w,Math.random()*h,2,1)})}
function texCone(){return canvasTex(16,64,function(x,w,h){x.fillStyle='#ff5a00';x.fillRect(0,0,w,h);x.fillStyle='#f2f2f2';x.fillRect(0,18,w,10);x.fillRect(0,36,w,7)})}
function texFenetres(){return canvasTex(64,128,function(x,w,h){x.fillStyle='#08060e';x.fillRect(0,0,w,h);
  for(var j=2;j<h-2;j+=6)for(var i=2;i<w-2;i+=5)if(Math.random()<.42){var r=Math.random();x.fillStyle=r<.6?'#ffd27a':r<.85?'#fff1d0':'#b48cff';x.fillRect(i,j,3,3)}})}
function texGrillage(){return canvasTex(128,128,function(x,w,h){x.clearRect(0,0,w,h);x.strokeStyle='rgba(190,190,200,.9)';x.lineWidth=2;
  for(var i=-128;i<256;i+=12){x.beginPath();x.moveTo(i,0);x.lineTo(i+128,128);x.stroke();x.beginPath();x.moveTo(i+128,0);x.lineTo(i,128);x.stroke()}x.lineWidth=6;x.strokeRect(0,0,w,h)})}
function texPanneau(txt,fond,encre,bord,w,h){return canvasTex(w||512,h||128,function(x,W,H){x.fillStyle=fond;x.fillRect(0,0,W,H);if(bord){x.strokeStyle=bord;x.lineWidth=H*.1;x.strokeRect(H*.05,H*.05,W-H*.1,H-H*.1)}
  x.fillStyle=encre;x.textAlign='center';x.textBaseline='middle';var L=txt.split('\n'),fs=Math.round(H*.5/L.length);x.font='bold '+fs+'px sans-serif';
  while(x.measureText(L.reduce(function(a,b){return a.length>b.length?a:b})).width>W*.88&&fs>8){fs--;x.font='bold '+fs+'px sans-serif'}
  L.forEach(function(l,i){x.fillText(l,W/2,H/2+(i-(L.length-1)/2)*fs*1.2)})})}
function texRond(){return canvasTex(64,64,function(x,w,h){var g=x.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.4,'rgba(255,255,255,.55)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(0,0,w,h)})}
function texNuage(){return canvasTex(256,128,function(x,w,h){for(var i=0;i<40;i++){var px=hasard(40,w-40),py=hasard(40,h-30),r=hasard(18,48),g=x.createRadialGradient(px,py,0,px,py,r);
  g.addColorStop(0,'rgba(255,255,255,.28)');g.addColorStop(1,'rgba(255,255,255,0)');x.fillStyle=g;x.fillRect(px-r,py-r,r*2,r*2)}})}
function texGalaxie(){return canvasTex(1024,1024,function(g,w,h){
  /* même galaxie spirale violette que le fond du site */
  var R=470,s=11,P=Math.PI,i;function r(){s=(s*1664525+1013904223)>>>0;return s/4294967296}function gs(){return(r()+r()+r()+r()-2)/2}
  function blob(px,py,rad,col,a){var q=g.createRadialGradient(px,py,0,px,py,rad);q.addColorStop(0,'rgba('+col+','+a+')');q.addColorStop(1,'rgba('+col+',0)');g.fillStyle=q;g.fillRect(px-rad,py-rad,rad*2,rad*2)}
  g.translate(w/2,h/2);g.globalCompositeOperation='lighter';
  blob(0,0,R,'70,28,150',.22);blob(0,0,R*.55,'130,80,235',.3);blob(0,0,R*.26,'200,160,255',.5);blob(0,0,R*.1,'250,240,255',.9);
  for(i=0;i<70;i++){var t=Math.pow(r(),.8),a=t*4.2+(i%2)*P+gs()*.3,d=R*.92*t;blob(Math.cos(a)*d,Math.sin(a)*d,R*(.06+r()*.1),r()<.3?'190,120,255':'110,60,220',.05+r()*.05)}
  for(i=0;i<5000;i++){var u=Math.pow(r(),.72),rr=R*.95*u,th=u*4.2+(i%2)*P+gs()*.42*(1-u*.45),px=Math.cos(th)*rr+gs()*R*.014,py=Math.sin(th)*rr+gs()*R*.014;
    g.fillStyle='rgba('+Math.round(235-u*105)+','+Math.round(215-u*135)+','+Math.round(255-u*35)+','+(.18+r()*.6)+')';g.beginPath();g.arc(px,py,.6+r()*1.8*(1-u*.4),0,6.283);g.fill()}})}

/* ===================================================================== PARTICULES (poussière, étincelles, fumée) */
function Particules(max,tex,additif){
  var g=new T.BufferGeometry(),pos=new Float32Array(max*3),col=new Float32Array(max*4),siz=new Float32Array(max),P=[],k=0;
  g.setAttribute('position',new T.BufferAttribute(pos,3));g.setAttribute('aCol',new T.BufferAttribute(col,4));g.setAttribute('aSize',new T.BufferAttribute(siz,1));
  var mat=new T.ShaderMaterial({uniforms:{map:{value:tex},uScale:{value:600}},transparent:true,depthWrite:false,blending:additif?T.AdditiveBlending:T.NormalBlending,
    vertexShader:'attribute vec4 aCol;attribute float aSize;varying vec4 vC;uniform float uScale;void main(){vC=aCol;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=aSize*uScale/-mv.z;gl_Position=projectionMatrix*mv;}',
    fragmentShader:'uniform sampler2D map;varying vec4 vC;void main(){vec4 t=texture2D(map,gl_PointCoord);gl_FragColor=vec4(vC.rgb,vC.a*t.a);}'});
  var pts=new T.Points(g,mat);pts.frustumCulled=false;
  for(var i=0;i<max;i++)P.push({v:new T.Vector3(),l:0,m:1,s0:1,gr:0,g:0,dr:1,a:1,c:new T.Color()});
  return{obj:pts,mat:mat,
    jet:function(p,v,l,s,c,a,g,dr,gr){var q=P[k],o=k*3;pos[o]=p.x;pos[o+1]=p.y;pos[o+2]=p.z;q.v.copy(v);q.l=q.m=l;q.s0=s;q.c.set(c);q.a=a;q.g=g||0;q.dr=dr||1;q.gr=gr||0;k=(k+1)%max},
    maj:function(dt){for(var i=0;i<max;i++){var q=P[i],o=i*3;if(q.l<=0){col[i*4+3]=0;continue}q.l-=dt;var f=Math.max(0,q.l/q.m);
      q.v.y-=q.g*dt;q.v.multiplyScalar(Math.pow(q.dr,dt*60));pos[o]+=q.v.x*dt;pos[o+1]+=q.v.y*dt;pos[o+2]+=q.v.z*dt;
      if(pos[o+1]<.02&&q.g>0){pos[o+1]=.02;q.v.y*=-.3;q.v.x*=.6;q.v.z*=.6}
      siz[i]=q.s0*(1+(1-f)*q.gr);col[i*4]=q.c.r;col[i*4+1]=q.c.g;col[i*4+2]=q.c.b;col[i*4+3]=q.a*Math.min(1,f*2.5)}
      g.attributes.position.needsUpdate=g.attributes.aCol.needsUpdate=g.attributes.aSize.needsUpdate=true}};
}

/* ===================================================================== OUTILS 3D */
function mesh(geo,mat,x,y,z,parent,ombre){var m=new T.Mesh(geo,mat);m.position.set(x||0,y||0,z||0);if(ombre!==false){m.castShadow=true;m.receiveShadow=true}if(parent)parent.add(m);return m}
function boite(w,h,d,mat,x,y,z,parent){return mesh(new T.BoxGeometry(w,h,d),mat,x,y,z,parent)}
function cyl(r1,r2,h,mat,x,y,z,parent,seg){return mesh(new T.CylinderGeometry(r1,r2,h,seg||16),mat,x,y,z,parent)}
function std(c,o){o=o||{};o.color=c;return new T.MeshStandardMaterial(o)}
function emissif(c,i){return std(c,{emissive:c,emissiveIntensity:i||2})}
function v3(a){return a.length>2?new T.Vector3(a[0],a[1],a[2]):new T.Vector3(a[0],0,a[1])}

/* ===================================================================== PERSONNAGES */
function Humain(o){
  o=o||{};var g=new T.Group(),c=new T.Group();g.add(c);
  var peau=std(o.peau||0xc68a63,{roughness:.7}),haut=std(o.haut||0x3a3f5c,{roughness:.85}),bas=std(o.bas||0x2b3350,{roughness:.85}),chaus=std(o.chaus||0x2a2018,{roughness:.9});
  function jambe(x){var h=new T.Group();h.position.set(x,.95,0);c.add(h);cyl(.078,.066,.46,bas,0,-.23,0,h,10);var k=new T.Group();k.position.y=-.46;h.add(k);
    cyl(.062,.056,.44,bas,0,-.22,0,k,10);boite(.13,.09,.27,chaus,0,-.465,.05,k);return[h,k]}
  var jG=jambe(.11),jD=jambe(-.11);
  boite(.36,.17,.24,bas,0,.99,0,c);boite(.44,.58,.25,haut,0,1.27,0,c);
  if(o.manteau)boite(.47,.82,.28,haut,0,1.17,0,c);
  if(o.gilet){boite(.47,.5,.28,std(o.gilet,{roughness:.55,emissive:o.gilet,emissiveIntensity:.08}),0,1.25,0,c);
    var refl=std(0xe8eef8,{emissive:0xffffff,emissiveIntensity:.35,metalness:.6,roughness:.3});boite(.48,.035,.29,refl,0,1.13,0,c);boite(.48,.035,.29,refl,0,1.31,0,c)}
  boite(.46,.05,.27,std(0x111),0,.98,0,c);cyl(.05,.05,.1,peau,0,1.58,0,c,8);
  var tete=new T.Group();tete.position.y=1.71;c.add(tete);mesh(new T.SphereGeometry(.13,18,14),peau,0,0,0,tete);
  [.045,-.045].forEach(function(x){mesh(new T.SphereGeometry(.016,8,6),std(0x111),x,.02,.118,tete,false)});boite(.03,.05,.04,peau,0,-.01,.13,tete);
  if(o.casque){var mk=std(o.casque,{roughness:.35,metalness:.1});mesh(new T.SphereGeometry(.155,18,10,0,Math.PI*2,0,Math.PI/2),mk,0,.04,0,tete);cyl(.2,.2,.025,mk,0,.045,.03,tete,24);boite(.02,.1,.3,mk,0,.15,0,tete)}
  else{var ch=std(o.cheveux||0x2a1a12,{roughness:.9});mesh(new T.SphereGeometry(.138,16,10,0,Math.PI*2,0,Math.PI*.55),ch,0,.015,-.01,tete);if(o.long)boite(.26,.22,.08,ch,0,-.08,-.1,tete);
    if(o.bonnet)mesh(new T.SphereGeometry(.142,16,10,0,Math.PI*2,0,Math.PI*.5),std(o.bonnet,{roughness:.95}),0,.03,0,tete)}
  function bras(x){var s=new T.Group();s.position.set(x,1.5,0);c.add(s);cyl(.056,.05,.3,haut,0,-.15,0,s,8);var e=new T.Group();e.position.y=-.3;s.add(e);
    cyl(.05,.044,.27,o.manches?haut:peau,0,-.135,0,e,8);var m=new T.Group();m.position.y=-.29;e.add(m);mesh(new T.SphereGeometry(.05,10,8),o.gants?std(0x2b2b2b,{roughness:.9}):peau,0,0,0,m);return[s,e,m]}
  var bG=bras(.29),bD=bras(-.29);
  if(o.tel){var tl=boite(.08,.15,.012,std(0x111,{metalness:.5,roughness:.3}),0,-.04,.05,bD[2]);boite(.07,.13,.002,emissif(0xcfd8ff,1.6),0,0,.007,tl)}
  return{g:g,c:c,tete:tete,tel:!!o.tel,J:{gx:jG[0],gk:jG[1],dx:jD[0],dk:jD[1],ga:bG[0],ge:bG[1],gm:bG[2],da:bD[0],de:bD[1],dm:bD[2],t:tete,c:c},
    s:{bouge:false,ph:Math.random()*6,v:1.4,brasLibres:true,regard:null,idle:Math.random()*6,pas:0}};
}
function assis(h){h.J.gx.rotation.x=h.J.dx.rotation.x=-1.5;h.J.gk.rotation.x=h.J.dk.rotation.x=1.5;h.J.ga.rotation.x=h.J.da.rotation.x=-.9;h.assis=true}

window.NALVO3D=function(opt){
  var fini=false,raf=0,W=innerWidth,H=innerHeight,son=Sons(opt.ac);
  /* --------------------------------------------------------------- écran par-dessus la page */
  var ov=document.createElement('div');ov.id='cine3d';ov.setAttribute('aria-hidden','true');
  ov.innerHTML='<style>#cine3d{position:fixed;inset:0;z-index:9999;background:#000;cursor:pointer;user-select:none;overflow:hidden;font-family:system-ui,Segoe UI,sans-serif}'+
    '#cine3d canvas{position:absolute;inset:0;width:100%;height:100%;display:block}'+
    '#cine3d .vg{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,.62))}'+
    '#cine3d .gr{position:absolute;inset:-50%;pointer-events:none;opacity:.06;animation:grain .4s steps(4) infinite}'+
    '@keyframes grain{25%{transform:translate(3%,-2%)}50%{transform:translate(-2%,3%)}75%{transform:translate(2%,2%)}}'+
    '#cine3d .bd{position:absolute;left:0;right:0;height:11vh;background:#000;z-index:3;display:flex;align-items:center;padding:0 5vw;color:#e9e3ff;font-size:clamp(.65rem,1.5vw,.95rem);letter-spacing:.32em;text-transform:uppercase;transition:transform .7s cubic-bezier(.2,.8,.2,1)}'+
    '#cine3d .bd.h{top:0;justify-content:flex-end;color:#8f86ad;transform:translateY(-100%)}#cine3d .bd.b{bottom:0;justify-content:space-between;transform:translateY(100%)}#cine3d.on .bd{transform:none}'+
    '#cine3d .titre{position:absolute;left:6vw;top:16vh;z-index:3;color:#fff;font-weight:900;font-style:italic;text-transform:uppercase;line-height:.95;opacity:0;transform:translateX(-30px);transition:all .6s cubic-bezier(.2,.8,.2,1);text-shadow:0 4px 0 #3b1a7a,0 0 30px rgba(139,92,246,.8)}'+
    '#cine3d .titre b{display:block;font-size:clamp(2rem,6vw,4.6rem);background:linear-gradient(90deg,#fff,#e9d5ff 40%,#f0abfc);-webkit-background-clip:text;background-clip:text;color:transparent}'+
    '#cine3d .titre span{display:block;font-size:clamp(.8rem,1.8vw,1.2rem);letter-spacing:.4em;color:#fcd34d;font-style:normal;margin-top:.6em}#cine3d .titre.on{opacity:1;transform:none}'+
    '#cine3d .ff{position:absolute;left:5vw;top:14vh;z-index:3;color:#fff;font-weight:800;font-size:clamp(1rem,2.4vw,1.6rem);letter-spacing:.1em;opacity:0;text-shadow:0 0 12px #000}'+
    '#cine3d .ff.on{opacity:1;animation:cl 1s steps(2) infinite}@keyframes cl{50%{opacity:.35}}'+
    '#cine3d .fl{position:absolute;inset:0;z-index:2;background:#fff;opacity:0;pointer-events:none}'+
    '#cine3d .tp{position:absolute;right:7vw;top:20vh;z-index:3;opacity:0;font-weight:900;font-size:clamp(2.2rem,8vw,6rem);color:#ff3b6b;border:.12em solid #ff3b6b;border-radius:.2em;padding:0 .3em;transform:rotate(-14deg) scale(3);text-shadow:0 0 24px rgba(255,59,107,.7);box-shadow:0 0 40px rgba(255,59,107,.4)}'+
    '#cine3d .tp.on{opacity:1;transform:rotate(-14deg) scale(1);transition:transform .32s cubic-bezier(.5,0,.9,.5),opacity .1s}'+
    '#cine3d .fin{position:absolute;inset:0;z-index:4;background:#000;opacity:0;pointer-events:none;transition:opacity .6s}</style>'+
    '<div class="vg"></div><div class="gr"></div><div class="fl"></div>'+
    '<div class="titre"><b>Mission :<br>réduction</b><span>Code accepté · −50 %</span></div><div class="ff">▶▶ ×3</div><div class="tp">−50 %</div>'+
    '<div class="bd h">Clique pour passer</div><div class="bd b"><span class="cap">Code de réduction</span><span>NALVO</span></div><div class="fin"></div>';
  var renderer;
  try{renderer=new T.WebGLRenderer({antialias:true,powerPreference:'high-performance'})}catch(e){throw new Error('WebGL indisponible')}
  if(!renderer.getContext())throw new Error('WebGL indisponible');
  document.body.appendChild(ov);document.documentElement.style.overflow='hidden';
  ov.querySelector('.gr').style.backgroundImage='url('+(function(){var c=document.createElement('canvas');c.width=c.height=128;var x=c.getContext('2d'),d=x.createImageData(128,128);
    for(var i=0;i<d.data.length;i+=4){var v=Math.random()*255;d.data[i]=d.data[i+1]=d.data[i+2]=v;d.data[i+3]=255}x.putImageData(d,0,0);return c.toDataURL()})()+')';
  var DPR=Math.min(devicePixelRatio||1,1.75);renderer.setPixelRatio(DPR);renderer.setSize(W,H);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  ov.insertBefore(renderer.domElement,ov.firstChild);
  function q(s){return ov.querySelector(s)}
  function cap(t){q('.cap').textContent=t}
  function flash(a){var f=q('.fl');f.style.transition='none';f.style.opacity=a;requestAnimationFrame(function(){f.style.transition='opacity .5s';f.style.opacity=0})}
  var V=new T.Vector3(),V2=new T.Vector3(),V3=new T.Vector3(),i;

  /* --------------------------------------------------------------- horloge et animations (déclarées tôt : utilisées partout) */
  var st=0,ts=1,last=performance.now(),TW=[];
  var io=function(p){return p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2},oc=function(p){return 1-Math.pow(1-p,3)},ic=function(p){return p*p*p},lin=function(p){return p};
  function tw(d,fn,ez){return new Promise(function(r){TW.push({t0:st,d:Math.max(d,1e-4),fn:fn,ez:ez||io,r:r})})}
  function attends(d){return tw(d,null)}

  /* --------------------------------------------------------------- scène, ciel violet de nuit et galaxie */
  var scene=new T.Scene(),camera=new T.PerspectiveCamera(45,W/H,.1,1200);son.setCam(camera);
  scene.fog=new T.Fog(0x140a26,45,340);
  var ciel=new T.Mesh(new T.SphereGeometry(600,32,16),new T.ShaderMaterial({side:T.BackSide,depthWrite:false,fog:false,
    uniforms:{top:{value:new T.Color(0x05040d)},mid:{value:new T.Color(0x2b1660)},bot:{value:new T.Color(0x0a0614)}},
    vertexShader:'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader:'uniform vec3 top,mid,bot;varying vec3 vP;void main(){vec3 n=normalize(vP);float h=n.y;vec3 c=h>0.?mix(mid,top,pow(clamp(h*2.2,0.,1.),.55)):mix(mid,bot,pow(clamp(-h*4.,0.,1.),.5));'+
      'vec3 sd=normalize(vec3(-.55,.06,-.83));float s=max(dot(n,sd),0.);c+=vec3(.55,.32,1.)*pow(s,6.)*.35;gl_FragColor=vec4(c,1.);}'}));
  scene.add(ciel);
  var pm=new T.PMREMGenerator(renderer),envScene=new T.Scene();envScene.add(ciel.clone());scene.environment=pm.fromScene(envScene,.04).texture;
  (function(){var n=700,p=new Float32Array(n*3);for(var i=0;i<n;i++){var a=Math.random()*6.28,e=.2+Math.random()*1.3;p[i*3]=Math.cos(a)*Math.cos(e)*560;p[i*3+1]=Math.sin(e)*560;p[i*3+2]=Math.sin(a)*Math.cos(e)*560}
    var g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(p,3));scene.add(new T.Points(g,new T.PointsMaterial({color:0xffffff,size:1.3,sizeAttenuation:false,fog:false,transparent:true,opacity:.8})))})();
  var galTex=texGalaxie();galTex.center.set(.5,.5);
  var galaxie=mesh(new T.PlaneGeometry(340,340),new T.MeshBasicMaterial({map:galTex,transparent:true,blending:T.AdditiveBlending,depthWrite:false,fog:false,opacity:.95}),0,0,0,scene,false);
  galaxie.position.set(-.45,.42,-1).normalize().multiplyScalar(500);galaxie.lookAt(0,0,0);galaxie.rotateZ(-.5);galaxie.scale.set(1,.55,1);
  var lune=mesh(new T.SphereGeometry(9,32,16),new T.MeshBasicMaterial({color:0xe9e2ff,fog:false}),0,0,0,scene,false);lune.position.set(.6,.33,-1).normalize().multiplyScalar(520);
  var halo=new T.Sprite(new T.SpriteMaterial({map:texRond(),color:0xb9a3ff,transparent:true,opacity:.5,blending:T.AdditiveBlending,depthWrite:false,fog:false}));halo.scale.set(70,70,1);halo.position.copy(lune.position);scene.add(halo);
  var nuages=[],tN=texNuage();for(i=0;i<10;i++){var nu=mesh(new T.PlaneGeometry(hasard(90,160),hasard(30,50)),new T.MeshBasicMaterial({map:tN,color:0x8d6fe0,transparent:true,opacity:hasard(.25,.45),depthWrite:false,fog:false}),0,0,0,scene,false);
    var an=hasard(-Math.PI,Math.PI),dn=hasard(260,380);nu.position.set(Math.cos(an)*dn,hasard(70,130),Math.sin(an)*dn);nu.lookAt(0,nu.position.y*.3,0);nu.userData.v=hasard(.6,1.4);nuages.push(nu)}
  var oiseaux=[],mO=new T.MeshBasicMaterial({color:0x0c0816,side:T.DoubleSide,fog:false});
  for(i=0;i<9;i++){var oi=new T.Group(),ai=new T.Mesh(new T.PlaneGeometry(.9,.25),mO),ai2=ai.clone();ai.position.x=.45;ai2.position.x=-.45;oi.add(ai,ai2);oi.userData={a:ai,b:ai2,k:i};scene.add(oi);oiseaux.push(oi)}
  scene.add(new T.HemisphereLight(0x5a48c0,0x1a1208,.55));
  var appoint=new T.DirectionalLight(0x8f7cff,.7);appoint.position.set(14,9,26);scene.add(appoint);
  var lunaire=new T.DirectionalLight(0x9d8cff,.55);lunaire.position.set(-20,30,-10);lunaire.castShadow=true;lunaire.shadow.mapSize.set(2048,2048);
  var sc=lunaire.shadow.camera;sc.left=sc.bottom=-34;sc.right=sc.top=34;sc.near=1;sc.far=110;lunaire.shadow.bias=-.0004;scene.add(lunaire);
  var violet=new T.PointLight(0x9b6bff,1.4,30,2);violet.position.set(0,7,7);scene.add(violet);

  /* --------------------------------------------------------------- sol : chantier, trottoir, route */
  var tSol=texSol(),solChantier=mesh(new T.PlaneGeometry(52,46),std(0xffffff,{map:tSol,bumpMap:tSol,bumpScale:.05,roughness:.92}),0,0,8,scene);solChantier.rotation.x=-Math.PI/2;solChantier.castShadow=false;
  var tB=texBeton();
  function bande(x,z,w,d,mat,y){var p=mesh(new T.PlaneGeometry(w,d),mat,x,y||0,z,scene);p.rotation.x=-Math.PI/2;p.castShadow=false;return p}
  var asphalte=std(0x26232b,{roughness:.85});bande(0,-60,700,600,asphalte,-.02);bande(-200,40,348,200,asphalte,-.02);bande(200,40,348,200,asphalte,-.02);bande(0,160,52,180,asphalte,-.02);
  bande(0,-17.6,240,5.2,std(0xffffff,{map:tB,roughness:.8}),.03);boite(240,.12,.25,std(0x8a8790,{roughness:.8}),0,.06,-20.15,scene);
  bande(0,-24.4,240,8.4,std(0xffffff,{map:texRoute(),roughness:.75}),.01);bande(0,-31,240,4.8,std(0xffffff,{map:tB.clone(),roughness:.8}),.03);
  [[-8,5,1.6],[9,6,1.1],[-3,-7,2],[12,-3,.9],[-30,-24,2.4],[18,-25,1.8]].forEach(function(f){var p=mesh(new T.CircleGeometry(f[2],24),std(0x120c18,{metalness:1,roughness:.05}),f[0],.035,f[1],scene);p.rotation.x=-Math.PI/2;p.castShadow=false});

  /* --------------------------------------------------------------- ville : immeubles proches avec commerces, ville lointaine, lampadaires */
  var tf=texFenetres(),clignotants=[];
  (function(){var x=-80,couls=[0xb48cff,0xff7ab8,0xffc46b,0x7ad7ff,0xc084fc];while(x<80){var w=hasard(10,17),h=hasard(9,28),dz=hasard(9,14),zc=-34-dz/2-hasard(0,4);
    var t=tf.clone();t.needsUpdate=true;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(Math.round(w/4),Math.round(h/4));
    boite(w,h,dz,std(0x15111d,{roughness:.8,emissive:0xffffff,emissiveMap:t,emissiveIntensity:.75}),x+w/2,h/2,zc,scene).castShadow=false;
    boite(w*.86,2.4,.15,emissif(couls[Math.random()*couls.length|0],.9),x+w/2,1.6,zc+dz/2+.05,scene).castShadow=false;
    boite(w*.92,.5,.6,std(0x2a2433),x+w/2,3.1,zc+dz/2+.3,scene);if(Math.random()<.4)boite(w*.5,.9,.12,emissif(couls[(Math.random()*5)|0],2.2),x+w/2,3.9,zc+dz/2+.2,scene).castShadow=false;
    if(Math.random()<.5){var a=mesh(new T.SphereGeometry(.3,8,6),new T.MeshBasicMaterial({color:0xff2a2a}),x+w/2,h+.6,zc,scene,false);a.userData.cl=Math.random()*6;clignotants.push(a)}
    x+=w+hasard(.3,2)}})();
  (function(){for(var i=0;i<70;i++){var a=hasard(0,Math.PI*2),r=hasard(230,330),w=hasard(12,26),h=hasard(14,70);
    var t=tf.clone();t.needsUpdate=true;t.wrapS=t.wrapT=T.RepeatWrapping;t.repeat.set(Math.round(w/6),Math.round(h/8));
    var b=mesh(new T.BoxGeometry(w,h,w),std(0x0c0a14,{roughness:.8,emissive:0xffffff,emissiveMap:t,emissiveIntensity:.8}),Math.cos(a)*r,h/2,Math.sin(a)*r,scene,false);b.lookAt(0,h/2,0);
    if(Math.random()<.3){var l=mesh(new T.SphereGeometry(.8,8,6),new T.MeshBasicMaterial({color:0xff2a2a}),b.position.x,h+1,b.position.z,scene,false);l.userData.cl=Math.random()*6;clignotants.push(l)}}})();
  var lampMat=emissif(0xe6dcff,3);
  for(var lx=-52;lx<=52;lx+=13){var lp=new T.Group();lp.position.set(lx,0,-20.4);scene.add(lp);cyl(.08,.11,6.5,std(0x3a3640,{metalness:.6,roughness:.4}),0,3.25,0,lp,8);
    boite(.12,.12,1.4,std(0x3a3640),0,6.4,.6,lp);boite(.5,.12,.3,lampMat,0,6.32,1.25,lp).castShadow=false;
  }
  var voitures=[];
  function voitureMesh(couleur){var g=new T.Group(),c=std(couleur,{metalness:.7,roughness:.25,envMapIntensity:1.5}),n=std(0x111,{roughness:.6}),vi=std(0x1b2a3a,{metalness:.3,roughness:.05,envMapIntensity:2});
    boite(4.2,.7,1.8,c,0,.65,0,g);boite(2.3,.6,1.6,vi,-.2,1.25,0,g);boite(2.2,.08,1.62,c,-.2,1.56,0,g);
    [[1.35,.85],[1.35,-.85],[-1.35,.85],[-1.35,-.85]].forEach(function(p){var r=cyl(.34,.34,.25,n,p[0],.34,p[1],g,14);r.rotation.x=Math.PI/2});
    [.6,-.6].forEach(function(z){boite(.06,.16,.4,emissif(0xfff4dc,4),2.11,.75,z,g).castShadow=false;boite(.06,.12,.4,emissif(0xff2030,3),-2.11,.8,z,g).castShadow=false});scene.add(g);return g}
  [[0x6d28d9,-23.4,1],[0xdedede,-26.2,-1],[0x1f2937,-23.4,1],[0x9b1c1c,-26.2,-1],[0x334155,-23.4,1],[0xe5e7eb,-26.2,-1]].forEach(function(c){var g=voitureMesh(c[0]);
    g.position.set(hasard(-90,90),0,c[1]);g.rotation.y=c[2]>0?0:Math.PI;voitures.push({g:g,d:c[2],v:hasard(8,13),son:false})});

  /* --------------------------------------------------------------- clôture (entrée à droite pour les engins, sortie à gauche), panneaux */
  (function(){var gm=std(0xbfc0c8,{map:texGrillage(),alphaTest:.5,side:T.DoubleSide,metalness:.6,roughness:.5}),po=std(0x777),bl=std(0x8a8a8f,{roughness:.9});
    function panneau(x,z,ry){var p=mesh(new T.PlaneGeometry(3,2.2),gm,x,1.3,z,scene);p.rotation.y=ry;boite(.3,.2,.6,bl,x,.1,z,scene).rotation.y=ry}
    for(var x=-24;x<=24;x+=3){panneau(x,-15,0);cyl(.04,.04,2.4,po,x-1.5,1.2,-15,scene,6)}
    for(var z=-12;z<=12;z+=3){if(z<5)panneau(-25.5,z,Math.PI/2);if(z<-5)panneau(25.5,z,Math.PI/2)}
    var tb=texPanneau('NALVO TRAVAUX','#1d1035','#ffffff','#8b5cf6');mesh(new T.PlaneGeometry(8,2),std(0xffffff,{map:tb,emissive:0xffffff,emissiveMap:tb,emissiveIntensity:.25,side:T.DoubleSide}),-9,1.3,-14.95,scene);
    mesh(new T.PlaneGeometry(2.2,1.1),std(0xffffff,{map:texPanneau('CHANTIER INTERDIT\nAU PUBLIC','#ffffff','#c81e1e','#c81e1e',512,256),side:T.DoubleSide}),6,1.5,-14.95,scene);
    mesh(new T.PlaneGeometry(2.6,1.3),std(0xffffff,{map:texPanneau('PERMIS DE CONSTRUIRE\nNALVO · RÉDUCTION −50 %','#f5f5f5','#1d1035','#1d1035',512,256),side:T.DoubleSide}),12,1.6,-14.9,scene)})();
  /* --------------------------------------------------------------- décor du chantier */
  var lampes=[];
  (function(){var rouge=std(0x9b1c1c,{roughness:.6,metalness:.4}),gris=std(0x6b7280,{roughness:.5,metalness:.6}),orange=std(0xff7a1a,{roughness:.5}),
      bois=std(0x8b5a2b,{roughness:.9}),brique=std(0xa0442c,{roughness:.9}),sable=std(0xc8a46b,{roughness:1}),bleu=std(0x1d4ed8,{roughness:.5}),blanc=std(0xe5e5ea,{roughness:.6});
    var bg=new T.Group();bg.position.set(-18,0,-8);scene.add(bg);boite(6,2.8,2.6,blanc,0,1.65,0,bg);boite(6.2,.15,2.8,gris,0,3.1,0,bg);
    for(var i=0;i<4;i++)boite(.08,.3,2.6,gris,-2.9+i*1.93,.15,0,bg);
    boite(1,.7,.05,emissif(0xffe6a8,1.4),-1.5,2,1.31,bg).castShadow=false;boite(1,.7,.05,emissif(0xffe6a8,1.4),.3,2,1.31,bg).castShadow=false;
    boite(.05,2,.9,std(0x333344),3.01,1.25,.4,bg);boite(.9,.25,1.2,gris,3.5,.13,.4,bg);boite(.6,.5,.4,gris,-2.3,2.2,1.5,bg);
    boite(.2,.12,.12,emissif(0xffd9a0,3),3.1,2.6,.4,bg).castShadow=false;
    var cont=new T.Group();cont.position.set(-20,0,-12.3);scene.add(cont);boite(6.5,2.7,2.6,rouge,0,1.35,0,cont);for(i=-3;i<=3;i+=.5)boite(.08,2.5,2.65,rouge,i,1.35,0,cont);
    for(i=0;i<6;i++){var p=cyl(.45,.45,5,i%2?gris:orange,-9+(i%3)*.95+(i>2?.47:0),.45+(i>2?.8:0),-12,scene,20);p.rotation.z=Math.PI/2;p.rotation.y=.15}
    mesh(new T.ConeGeometry(3.2,2.4,24),sable,15,1.2,-10.5,scene);mesh(new T.ConeGeometry(2,1.5,20),std(0x5b5450,{roughness:1}),19,.75,-7.5,scene);
    var wc=new T.Group();wc.position.set(-22.5,0,-2);wc.rotation.y=Math.PI/2;scene.add(wc);boite(1.3,2.4,1.3,bleu,0,1.2,0,wc);boite(1.4,.12,1.4,blanc,0,2.45,0,wc);
    for(i=0;i<3;i++){boite(1.2,.15,1.2,bois,-13+i*1.5,.08,-12.5,scene);for(var j=0;j<3;j++)boite(1,.3,.5,brique,-13+i*1.5,.3+j*.31,-12.5+(j%2)*.1,scene)}
    var ge=new T.Group();ge.position.set(16,0,3.2);ge.rotation.y=-.4;scene.add(ge);boite(2,1.2,1.1,std(0xf2b705,{roughness:.5}),0,.6,0,ge);boite(2.1,.1,1.2,std(0x222222),0,1.25,0,ge);
    var gl=mesh(new T.SphereGeometry(.08,8,6),new T.MeshBasicMaterial({color:0x22ff66}),.8,1.35,.4,ge,false);gl.userData.cl=1;clignotants.push(gl);
    var br=new T.Group();br.position.set(12,0,-6);br.rotation.y=.7;scene.add(br);boite(1,.35,.7,std(0x3f6b2a,{roughness:.6,metalness:.3}),0,.55,0,br);
    var rb=cyl(.2,.2,.08,std(0x111111),.65,.2,0,br,12);rb.rotation.x=Math.PI/2;[.25,-.25].forEach(function(z){var m=boite(1.4,.04,.04,gris,-.2,.42,z,br);m.rotation.z=.15})})();
  function faisceau(de,vers,angle,couleur,force,parent){var L=vers?de.distanceTo(vers)*1.1:9,g=new T.ConeGeometry(Math.tan(angle)*L,L,40,1,true);g.translate(0,-L/2,0);g.rotateX(-Math.PI/2);
    var m=new T.Mesh(g,new T.ShaderMaterial({transparent:true,depthWrite:false,blending:T.AdditiveBlending,side:T.DoubleSide,fog:false,uniforms:{c:{value:new T.Color(couleur)},f:{value:force},L:{value:L}},
      vertexShader:'varying float vT;varying vec3 vN,vV;uniform float L;void main(){vT=position.z/L;vec4 mv=modelViewMatrix*vec4(position,1.);vN=normalize(normalMatrix*normal);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}',
      fragmentShader:'uniform vec3 c;uniform float f;varying float vT;varying vec3 vN,vV;void main(){float e=pow(abs(dot(vN,vV)),1.5);gl_FragColor=vec4(c*f*e*pow(1.-clamp(vT,0.,1.),1.6),1.);}'}));
    m.position.copy(de);(parent||scene).add(m);if(!parent)m.lookAt(vers);return m}
  [[-12.5,-5.5],[12.5,-6.5]].forEach(function(p,k){var g=new T.Group();g.position.set(p[0],0,p[1]);scene.add(g);cyl(.12,.16,9,std(0x555555),0,4.5,0,g,8);
    var t=boite(2,.9,.4,std(0x222222),0,9,0,g);t.lookAt(0,0,0);mesh(new T.PlaneGeometry(1.8,.7),new T.MeshBasicMaterial({color:0xfff6dd}),0,0,.21,t,false);
    var s=new T.SpotLight(0xfff1d6,2.6,60,.5,.45,1.3);s.position.set(p[0],9,p[1]);s.target.position.set(0,1,0);scene.add(s,s.target);
    if(!k){s.castShadow=true;s.shadow.mapSize.set(1024,1024);s.shadow.bias=-.0006}faisceau(new T.Vector3(p[0],8.9,p[1]),new T.Vector3(0,1,0),.5,0xfff1d6,.09)});
  var motes=(function(){var n=500,p=new Float32Array(n*3);for(var i=0;i<n;i++){p[i*3]=hasard(-18,18);p[i*3+1]=hasard(0,9);p[i*3+2]=hasard(-12,12)}
    var g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(p,3));var o=new T.Points(g,new T.PointsMaterial({size:.06,map:texRond(),color:0xe6dcff,transparent:true,opacity:.55,depthWrite:false,blending:T.AdditiveBlending}));
    o.userData.base=p.slice();scene.add(o);return o})();

  /* --------------------------------------------------------------- le 10 € sur sa plateforme */
  var police=new T.FontLoader().parse(opt.font);
  function euro(R){var a=.78,t=R*.3,s=new T.Shape();s.absarc(0,0,R,a,Math.PI*2-a,false);s.absarc(0,0,R-t,Math.PI*2-a,a,true);
    function barre(y){var b=new T.Shape();b.moveTo(-R*1.28,y-R*.085);b.lineTo(R*.32,y-R*.085);b.lineTo(R*.36,y+R*.085);b.lineTo(-R*1.2,y+R*.085);return b}
    return new T.ExtrudeGeometry([s,barre(R*.2),barre(-R*.2)],{depth:1,bevelEnabled:true,bevelThickness:.12,bevelSize:.07,bevelSegments:3,curveSegments:28})}
  function prix(txt,mat){var g=new T.Group(),geo=new T.TextGeometry(txt,{font:police,size:3,height:1,curveSegments:10,bevelEnabled:true,bevelThickness:.12,bevelSize:.07,bevelSegments:3});
    geo.computeBoundingBox();var b=geo.boundingBox,Hh=b.max.y-b.min.y,R=Hh/2;mesh(geo,mat,0,0,0,g);var e=mesh(euro(R),mat,b.max.x+R*1.3+.35,b.min.y+R,0,g);
    var bb=new T.Box3().setFromObject(g),cx=(bb.min.x+bb.max.x)/2;g.children.forEach(function(c){c.position.x-=cx;c.position.y-=bb.min.y;c.position.z-=.5});
    g.userData={H:bb.max.y-bb.min.y,L:bb.max.x-bb.min.x,euro:e};return g}
  var matViolet=std(0x8b5cf6,{metalness:.85,roughness:.22,emissive:0x2a0f66,emissiveIntensity:.7,envMapIntensity:1.4}),
      matOr=std(0xffc23a,{metalness:1,roughness:.16,emissive:0x5a3300,emissiveIntensity:.6,envMapIntensity:1.6});
  var dix=prix('10',matViolet),Hn=dix.userData.H,Ln=dix.userData.L,SX=Ln/2+1.2,SZ=1.3;
  boite(Ln+2.4,.6,2.6,std(0x4a4a52,{roughness:.85}),0,.3,0,scene);boite(Ln+2.8,.12,3,std(0x3a3a40,{roughness:.9}),0,.06,0,scene);
  var tenue=new T.Group();tenue.position.set(0,.6,0);scene.add(tenue);tenue.add(dix);scene.updateMatrixWorld(true);
  var euroX=dix.userData.euro.getWorldPosition(new T.Vector3()).x,hautY=.6+Hn;
  var lumPrix=new T.PointLight(0xb48cff,0,14,2);lumPrix.position.set(0,2.5,3);scene.add(lumPrix);

  /* --------------------------------------------------------------- particules */
  var rond=texRond(),poussiere=Particules(1200,rond,false),etinc=Particules(900,rond,true);scene.add(poussiere.obj,etinc.obj);
  function nuage(p,n,force,col,taille){for(var i=0;i<n;i++){V.set(Math.random()-.5,Math.random()*.6,Math.random()-.5).normalize().multiplyScalar(force*(.3+Math.random()));
    poussiere.jet(p,V,1.4+Math.random()*1.4,(taille||1.6)*(.6+Math.random()),col||0x9c8a78,.5,-.15,.96,2.2)}}
  function gerbe(p,n,force){for(var i=0;i<n;i++){V.set(Math.random()-.5,Math.random()*.9+.1,Math.random()-.5).normalize().multiplyScalar(force*(.4+Math.random()));
    etinc.jet(p,V,.35+Math.random()*.5,.12+Math.random()*.12,Math.random()<.5?0xffd27a:0xffffff,1,9,.985,0)}}

  /* --------------------------------------------------------------- 50 morceaux taillés, pris dans la forme des lettres ; ils restent sur la plateforme */
  var fragMat=matViolet.clone();fragMat.flatShading=true;
  function caillou(){var g=new T.IcosahedronGeometry(1,0),p=g.attributes.position,dec={};for(var i=0;i<p.count;i++){var k=p.getX(i).toFixed(2)+p.getY(i).toFixed(2)+p.getZ(i).toFixed(2);
      if(!dec[k])dec[k]=[hasard(.65,1.25),hasard(.65,1.25),hasard(.65,1.25)];p.setXYZ(i,p.getX(i)*dec[k][0],p.getY(i)*dec[k][1],p.getZ(i)*dec[k][2])}g.computeVertexNormals();return g}
  var frags=[];
  (function(){var rc=new T.Raycaster(),cibles=[],essais=0;dix.traverse(function(o){if(o.isMesh)cibles.push(o)});
    while(frags.length<50&&essais<8000){essais++;var x=hasard(-Ln/2,Ln/2),y=hasard(.6,.6+Hn);rc.set(V.set(x,y,3),V2.set(0,0,-1));if(!rc.intersectObjects(cibles).length)continue;
      if(frags.some(function(f){return Math.hypot(f.p.x-x,f.p.y-y)<.4}))continue;
      var s=hasard(.24,.38),m=mesh(caillou(),fragMat,x,y,hasard(-.15,.15),scene);m.scale.set(s*hasard(.9,1.4),s*hasard(.8,1.2),s*hasard(.9,1.3));m.rotation.set(hasard(0,6),hasard(0,6),hasard(0,6));m.visible=false;
      frags.push({m:m,p:m.position,v:new T.Vector3(),w:new T.Vector3(),r:s,zone:'socle',repos:false})}})();
  var BENNE={x:-7.2,z:6.6,sx:1.3,sz:.8,sol:.22};
  function majFrags(dt){frags.forEach(function(f){if(!f.m.visible||f.zone==='godet'||f.repos)return;f.v.y-=18*dt;f.p.addScaledVector(f.v,dt);
      f.m.rotation.x+=f.w.x*dt;f.m.rotation.y+=f.w.y*dt;f.m.rotation.z+=f.w.z*dt;
      var sol,bx,bz,cx=0,cz=0;if(f.zone==='socle'){sol=.6;bx=SX-f.r;bz=SZ-f.r}else{sol=BENNE.sol;bx=BENNE.sx-f.r*.6;bz=BENNE.sz-f.r*.6;cx=BENNE.x;cz=BENNE.z}
      if(f.p.x<cx-bx){f.p.x=cx-bx;f.v.x*=-.3}if(f.p.x>cx+bx){f.p.x=cx+bx;f.v.x*=-.3}if(f.p.z<cz-bz){f.p.z=cz-bz;f.v.z*=-.3}if(f.p.z>cz+bz){f.p.z=cz+bz;f.v.z*=-.3}
      if(f.p.y<sol+f.r*.7){f.p.y=sol+f.r*.7;if(Math.abs(f.v.y)>3&&Math.random()<.3)son.tick(f.p);f.v.y*=-.25;f.v.x*=.6;f.v.z*=.6;f.w.multiplyScalar(.5);
        if(f.v.lengthSq()<.05&&f.w.lengthSq()<.2)f.repos=true}})}

  /* --------------------------------------------------------------- barrières, plots, benne ; chemins à pied qui contournent tout */
  var matRay=std(0xffffff,{map:texRayures(),roughness:.5}),matPied=std(0x2a2a35,{roughness:.6}),barrieres=[],plots=[];
  function barriere(){var g=new T.Group(),bl=std(0x1d1d24,{roughness:.8});[-.8,.8].forEach(function(x){var a=boite(.07,1.15,.07,matPied,x,.55,.25,g);a.rotation.x=.3;var b=boite(.07,1.15,.07,matPied,x,.55,-.25,g);b.rotation.x=-.3;
      boite(.18,.08,.8,bl,x,.04,0,g)});
    boite(2,.32,.06,matRay,0,.86,0,g);boite(1.8,.2,.05,matRay,0,.48,0,g);boite(.12,.06,.065,std(0xffffff,{emissive:0xffffff,emissiveIntensity:.4}),-.6,.86,.035,g);
    var lm=std(0xffa000,{emissive:0xffa000,emissiveIntensity:2}),l=cyl(.07,.08,.14,lm,.62,1.1,0,g,10);l.castShadow=false;cyl(.012,.012,.12,matPied,.62,1.0,0,g,6);
    g.userData.lampe=lm;g.userData.ph=Math.random()*6;scene.add(g);lampes.push(g);return g}
  var PILE=new T.Vector3(-11.8,0,1.5),pileEst=0,pileOuest=5;
  for(var bi=0;bi<6;bi++){var bb=barriere();bb.position.set(PILE.x-bi*.3,0,PILE.z);bb.rotation.y=Math.PI/2+.06;barrieres.push(bb)}
  var placesB=[{x:-3.6,z:-3,r:0,de:[-3.6,-4.2]},{x:3.6,z:-3,r:0,de:[3.6,-4.2]},{x:-7.4,z:0,r:Math.PI/2,de:[-8.5,0]},{x:-3.6,z:3,r:0,de:[-3.6,4.2]},{x:3.6,z:3,r:0,de:[3.6,4.2]},{x:7.4,z:0,r:Math.PI/2,de:[8.5,0]}];
  var DEP=[-10.6,1.5],NO=[-9,-4.6],NE=[9,-4.6],SE=[9,4.6],SO=[-9,4.6];
  var DEPC=[-14.3,1.5],NOC=[-10.4,-5.4],SOC=[-10.4,5.0],
      /* l'ouvrier passe par l'anneau intérieur, le chef par l'anneau extérieur : ils ne se croisent pas */
      routes={2:[DEP,placesB[2].de],0:[DEP,NO,[-3.6,-4.6],placesB[0].de],3:[DEP,SO,[-3.6,4.6],placesB[3].de],
        1:[DEPC,[-13.8,-1.2],NOC,[3.6,-5.0],placesB[1].de],4:[DEPC,[-13.6,3.8],SOC,[3.6,4.8],placesB[4].de],5:[DEPC,[-13.6,3.8],SOC,[9.4,5.0],[9.4,0],placesB[5].de]};
  var matCone=std(0xffffff,{map:texCone(),roughness:.6});
  [[-5.2,3.7],[5.2,3.7],[-5.2,-3.7],[5.2,-3.7],[21,-3.5],[21,13.4],[-21,13.4]].forEach(function(p){var c=new T.Group();mesh(new T.ConeGeometry(.24,.75,20),matCone,0,.42,0,c);boite(.5,.05,.5,std(0x111111),0,.025,0,c);
    c.position.set(p[0],0,p[1]);if(Math.abs(p[0])<10){c.scale.setScalar(.001);c.visible=false;plots.push(c)}scene.add(c)});
  (function(){var g=new T.Group(),m=std(0x5b2a9e,{roughness:.55,metalness:.45}),r=std(0x3b1a6b,{roughness:.7});g.position.set(BENNE.x,0,BENNE.z);scene.add(g);
    boite(2.9,.12,1.9,r,0,.1,0,g);boite(.12,1.3,1.9,m,-1.45,.7,0,g);boite(.12,1.3,1.9,m,1.45,.7,0,g);boite(2.9,1.3,.12,m,0,.7,-.95,g);boite(2.9,1.3,.12,m,0,.7,.95,g);
    for(var i=-1;i<=1;i++)boite(.08,1.2,.04,r,i*.9,.7,.98,g);mesh(new T.PlaneGeometry(1.4,.35),std(0xffffff,{map:texPanneau('NALVO','#5b2a9e','#ffffff',null,256,64)}),0,.9,1.02,g,false)})();

  /* --------------------------------------------------------------- véhicules : suivre un chemin (les roues tournent selon la distance) */
  function chemin(pts,bez){var P=pts.map(function(p){return new T.Vector3(p[0],0,p[1])});return bez?new T.QuadraticBezierCurve3(P[0],P[1],P[2]):(P.length>2?new T.CatmullRomCurve3(P,false,'centripetal'):new T.LineCurve3(P[0],P[1]))}
  function roule(veh,pts,v,o){o=o||{};var cu=chemin(pts,o.bez),L=cu.getLength(),dern=0,dir=new T.Vector3();veh.vit=v;
    return tw(L/v,function(u){var p=cu.getPointAt(u),t=cu.getTangentAt(Math.min(u,.999));veh.g.position.set(p.x,veh.g.position.y,p.z);
      dir.copy(t);if(o.recul)dir.negate();veh.g.rotation.y=Math.atan2(-dir.z,dir.x);var d=(u-dern)*L;dern=u;
      veh.roues.forEach(function(r){r.rotation.z-=d/r.userData.r*(o.recul?-1:1)})},o.ez||io).then(function(){veh.vit=0})}

  /* --------------------------------------------------------------- la tractopelle (avec son conducteur) */
  var B=new T.Group(),Bj=std(0xf2b705,{roughness:.42,metalness:.35}),Bn=std(0x1c1c22,{roughness:.6,metalness:.4}),Bp=std(0x111111,{roughness:.95}),
      Bc=std(0xcfd3da,{metalness:1,roughness:.18}),Bv=std(0x1b2a3a,{metalness:.2,roughness:.04,transparent:true,opacity:.45,envMapIntensity:2});
  scene.add(B);var tracto={g:B,roues:[],vit:0};
  function roue(veh,par,x,z,r,w,jante){var g=new T.Group();g.position.set(x,r,z);par.add(g);var t=cyl(r,r,w,Bp,0,0,0,g,28);t.rotation.x=Math.PI/2;
    var j=cyl(r*.55,r*.55,w+.04,jante,0,0,0,g,18);j.rotation.x=Math.PI/2;
    for(var k=0;k<6;k++)mesh(new T.SphereGeometry(r*.07,6,4),Bc,Math.cos(k)*r*.35,Math.sin(k)*r*.35,(w/2+.03)*(z>0?1:-1),g,false);
    for(k=0;k<14;k++){var cr=boite(.12,r*.12,w*.95,Bp,Math.cos(k/14*6.283)*r,Math.sin(k/14*6.283)*r,0,g);cr.rotation.z=k/14*6.283}
    g.userData.r=r;veh.roues.push(g);return g}
  boite(5.4,1.1,2.2,Bj,0,1.45,0,B);boite(5.6,.25,2.3,Bn,0,.95,0,B);boite(2.2,1,1.9,Bj,1.7,2.4,0,B);boite(2.25,.12,1.95,Bn,1.7,2.92,0,B);
  for(i=0;i<5;i++)boite(.04,.6,1.92,Bn,2.85,2.35,0,B).castShadow=false;
  var cab=new T.Group();cab.position.set(-.7,2,0);B.add(cab);
  [[.95,0],[-.95,0]].forEach(function(c){boite(.1,2,.1,Bn,c[0],1,1.05,cab);boite(.1,2,.1,Bn,c[0],1,-1.05,cab)});
  boite(1.8,1.7,2.05,Bv,0,1.05,0,cab).castShadow=false;boite(2.2,.16,2.4,Bj,0,2.05,0,cab);boite(.5,.6,.5,Bn,.3,.5,0,cab);
  var conducteur=Humain({haut:0x3a3f5c,casque:0xffc81a,gilet:0xff6a00});conducteur.g.scale.setScalar(.95);conducteur.g.position.set(0,-.55,0);conducteur.g.rotation.y=-Math.PI/2;cab.add(conducteur.g);assis(conducteur);
  var gyro=std(0xff8a00,{emissive:0xff7a00,emissiveIntensity:3}),gy=cyl(.13,.15,.26,gyro,0,2.26,0,cab,12);
  cyl(.08,.08,1.3,Bc,1.2,3.4,.6,B,10);
  [.62,-.62].forEach(function(z){boite(.08,.25,.4,emissif(0xfff3d0,3),2.82,2.25,z,B).castShadow=false;boite(.12,.2,.5,emissif(0xfff3d0,3),-.95,3.95,z,B).castShadow=false});
  var spotAR=new T.SpotLight(0xfff1d6,0,30,.6,.5,1.2);spotAR.position.set(-1,4,0);B.add(spotAR);B.add(spotAR.target);spotAR.target.position.set(-8,0,0);
  var faisAR=faisceau(new T.Vector3(-1,4,0),null,.45,0xfff1d6,.07,B);faisAR.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(-7,-4,0).normalize());faisAR.visible=false;
  var tL=texPanneau('NALVO TRAVAUX','#1d1035','#ffffff','#8b5cf6');[1.12,-1.12].forEach(function(z){var lg=mesh(new T.PlaneGeometry(2.2,.55),std(0xffffff,{map:tL,roughness:.5}),.1,1.5,z,B,false);if(z<0)lg.rotation.y=Math.PI});
  roue(tracto,B,-1.5,1.3,.98,.75,Bj);roue(tracto,B,-1.5,-1.3,.98,.75,Bj);roue(tracto,B,1.95,1.2,.62,.5,Bj);roue(tracto,B,1.95,-1.2,.62,.5,Bj);
  var chg=new T.Group();chg.position.set(.4,2.1,0);B.add(chg);[1.25,-1.25].forEach(function(z){var b=boite(3.3,.22,.18,Bj,1.6,-.25,z,chg);b.rotation.z=-.22});
  var godetAV=new T.Group();godetAV.position.set(3.4,-.95,0);chg.add(godetAV);boite(.12,.9,2.8,Bn,0,0,0,godetAV);boite(.9,.1,2.8,Bn,.45,-.45,0,godetAV);boite(.9,.9,.08,Bn,.45,0,1.38,godetAV);boite(.9,.9,.08,Bn,.45,0,-1.38,godetAV);
  var stabs=[];[1.25,-1.25].forEach(function(z){var s=new T.Group();s.position.set(-2.75,1.3,z);B.add(s);boite(.25,1.2,.25,Bj,0,-.4,0,s);boite(.6,.12,.6,Bn,0,-1,0,s);stabs.push(s)});
  /* bras arrière : pivote autour de sa base et se plie (cinématique inverse à deux segments) */
  var L1=4.6,L2=3.8,base=new T.Vector3(-2.9,2.0,0);
  var flecheG=new T.Group();flecheG.position.copy(base);B.add(flecheG);boite(.6,.7,.7,Bn,0,0,0,flecheG);
  var fleche=new T.Group();flecheG.add(fleche);boite(L1,.5,.42,Bj,L1/2,0,0,fleche);var ve1=cyl(.06,.06,2.4,Bc,1.4,.38,0,fleche,8);ve1.rotation.z=Math.PI/2;
  var balancier=new T.Group();balancier.position.set(L1,0,0);fleche.add(balancier);boite(L2,.38,.34,Bj,L2/2,0,0,balancier);var ve2=cyl(.05,.05,2,Bc,1.1,.3,0,balancier,8);ve2.rotation.z=Math.PI/2;
  var godet=new T.Group();godet.position.set(L2,0,0);balancier.add(godet);
  boite(.9,.12,1.1,Bn,.45,.35,0,godet);boite(.12,.75,1.1,Bn,.06,0,0,godet);boite(.9,.7,.08,Bn,.45,0,.53,godet);boite(.9,.7,.08,Bn,.45,0,-.53,godet);
  for(i=-1;i<=1;i++){var dent=mesh(new T.ConeGeometry(.08,.3,6),Bc,.95,-.25,i*.36,godet);dent.rotation.z=-Math.PI/2}
  var REPOS=new T.Vector3(-.6,5,0),bras={loc:true,w:new T.Vector3(),tilt:0};
  function cibleBras(out){return bras.loc?B.localToWorld(out.copy(REPOS)):out.copy(bras.w)}
  function ikBras(){cibleBras(V);B.updateMatrixWorld();B.worldToLocal(V);var dx=V.x-base.x,dz=V.z-base.z,dy=V.y+.85-base.y,yaw=clamp(Math.atan2(dz,-dx),-2.7,2.7);
    flecheG.rotation.y=yaw;var r=Math.hypot(dx,dz),tx=-r,ty=dy,D=Math.min(Math.hypot(tx,ty),L1+L2-.02),c2=(D*D-L1*L1-L2*L2)/(2*L1*L2),
      t2=Math.acos(clamp(c2,-1,1)),phi=Math.atan2(ty,tx),t1=phi-Math.atan2(L2*Math.sin(t2),L1+L2*Math.cos(t2));
    fleche.rotation.z=t1;balancier.rotation.z=t2;godet.rotation.z=-Math.PI/2+bras.tilt-(t1+t2)}
  /* le godet se déplace en tournant autour de la base (comme une vraie pelle) : il ne passe jamais à travers l'engin */
  function brasVers(p,d,tilt,ez,versRepos){var bw=B.localToWorld(base.clone()),p0=cibleBras(new T.Vector3()),t0=bras.tilt,t1=tilt==null?t0:tilt;bras.loc=false;bras.w.copy(p0);
    var a0=Math.atan2(p0.z-bw.z,p0.x-bw.x),r0=Math.hypot(p0.x-bw.x,p0.z-bw.z);
    return tw(d,function(k){var p1=versRepos?B.localToWorld(V3.copy(REPOS)):v3(p),a1=Math.atan2(p1.z-bw.z,p1.x-bw.x),r1=Math.hypot(p1.x-bw.x,p1.z-bw.z);
      while(a1-a0>Math.PI)a1-=Math.PI*2;while(a1-a0<-Math.PI)a1+=Math.PI*2;var a=a0+(a1-a0)*k,r=r0+(r1-r0)*k;
      bras.w.set(bw.x+Math.cos(a)*r,p0.y+(p1.y-p0.y)*k,bw.z+Math.sin(a)*r);bras.tilt=t0+(t1-t0)*k},ez||io).then(function(){if(versRepos)bras.loc=true})}
  function pointeGodet(){return godet.localToWorld(new T.Vector3(1.0,-.25,0))}
  B.position.set(48,0,11);B.rotation.y=Math.PI;

  /* --------------------------------------------------------------- convoi exceptionnel : voiture pilote + camion-grue qui transporte le 5 € */
  function voiturePilote(){var g=new T.Group(),blanc=std(0xf1f1f4,{metalness:.5,roughness:.3}),vi=std(0x1b2a3a,{metalness:.3,roughness:.05,envMapIntensity:2}),v={g:g,roues:[],vit:0};
    boite(4.3,.75,1.85,blanc,0,.7,0,g);boite(2.4,.6,1.65,vi,-.2,1.33,0,g);boite(2.3,.08,1.67,blanc,-.2,1.66,0,g);
    boite(.8,.06,1.5,std(0x222222),-.2,1.74,0,g);var gl=emissif(0xff8a00,3);[.65,-.65].forEach(function(z){cyl(.09,.1,.14,gl,-.2,1.83,z,g,10).castShadow=false});
    var tp=texPanneau('CONVOI\nEXCEPTIONNEL','#ffd400','#111111','#dd1111',512,256);var pn=mesh(new T.PlaneGeometry(1.4,.7),std(0xffffff,{map:tp,side:T.DoubleSide}),-.2,2.2,0,g);pn.rotation.y=Math.PI/2;
    cyl(.02,.02,.4,std(0x111111),-.2,1.9,0,g,6);
    [[1.4,.9],[1.4,-.9],[-1.4,.9],[-1.4,-.9]].forEach(function(p){roue(v,g,p[0],p[1],.35,.25,std(0x9ca3af,{metalness:.8,roughness:.3}))});
    [.6,-.6].forEach(function(z){boite(.06,.16,.4,emissif(0xfff4dc,4),2.16,.8,z,g).castShadow=false;boite(.06,.12,.4,emissif(0xff2030,3),-2.16,.85,z,g).castShadow=false});
    var chauf=Humain({haut:0x333344,cheveux:0x1a1410});chauf.g.position.set(.1,.05,.4);chauf.g.rotation.y=Math.PI/2;assis(chauf);g.add(chauf.g);
    v.gyro=gl;scene.add(g);return v}
  var pilote=voiturePilote();pilote.g.position.set(56,0,9.5);pilote.g.rotation.y=Math.PI;
  var K=new T.Group(),Kc=std(0x3b1f7a,{metalness:.6,roughness:.3,envMapIntensity:1.4}),Kn=std(0x18161d,{roughness:.6,metalness:.4}),camion={g:K,roues:[],vit:0};scene.add(K);
  boite(2.6,2.4,2.5,Kc,6.6,2.25,0,K);boite(.1,1.1,2.2,std(0x1b2a3a,{metalness:.3,roughness:.05,envMapIntensity:2}),7.92,2.6,0,K);boite(.15,.9,2.2,Kn,7.92,1.3,0,K);
  for(i=0;i<6;i++)boite(.05,.06,2,Bc,8.0,.95+i*.12,0,K).castShadow=false;
  [.85,-.85].forEach(function(z){boite(.08,.22,.45,emissif(0xfff4dc,4),8.0,.9,z,K).castShadow=false});
  var gyK=emissif(0xff8a00,3);[.8,-.8].forEach(function(z){cyl(.1,.12,.18,gyK,6.6,3.55,z,K,10).castShadow=false});
  [1.35,-1.35].forEach(function(z){boite(.05,.4,.25,Kn,7.6,2.6,z*1.05,K);cyl(.12,.12,2.4,Bc,5.2,2.6,z*.85,K,10)});
  cyl(.35,.35,1.2,Bc,5.3,.9,1.2,K,16).rotation.x=Math.PI/2;
  var tCE=texPanneau('CONVOI EXCEPTIONNEL','#ffd400','#111111','#dd1111',512,96),pAv=mesh(new T.PlaneGeometry(2.2,.42),std(0xffffff,{map:tCE}),8.03,1.65,0,K,false);pAv.rotation.y=Math.PI/2;
  var tK=texPanneau('NALVO TRANSPORTS','#3b1f7a','#ffffff',null,512,96);[1.26,-1.26].forEach(function(z){var p=mesh(new T.PlaneGeometry(2.2,.4),std(0xffffff,{map:tK}),6.6,2.9,z,K,false);if(z<0)p.rotation.y=Math.PI});
  boite(5,.4,1.2,Kn,4.5,.95,0,K);boite(13,.25,2.5,std(0x2b2733,{roughness:.6,metalness:.5}),-2.5,1.05,0,K);boite(13,.12,2.5,std(0x5b4636,{roughness:.9}),-2.5,1.22,0,K);
  for(var ix=-8;ix<=3.5;ix+=1.3)[1.27,-1.27].forEach(function(z){boite(.06,.12,.04,emissif(0xff9a00,2),ix,1.0,z,K).castShadow=false});
  var pAr=mesh(new T.PlaneGeometry(2.2,.42),std(0xffffff,{map:tCE}),-9.03,1.0,0,K,false);pAr.rotation.y=-Math.PI/2;
  [.9,-.9].forEach(function(z){boite(.06,.2,.5,emissif(0xff2030,3),-9.02,1.0,z,K).castShadow=false});
  var jK=std(0x9ca3af,{metalness:.8,roughness:.3});[7.1,4.6,3.6,-5.5,-6.6,-7.7].forEach(function(x){roue(camion,K,x,1.05,.55,.45,jK);roue(camion,K,x,-1.05,.55,.45,jK)});
  var stabK=[];[1,-1].forEach(function(s){var g=new T.Group();g.position.set(3.6,.95,0);K.add(g);var bm=boite(1.2,.25,.3,std(0xffc81a,{roughness:.5}),0,0,s*.6,g),pied=new T.Group();g.add(pied);
    boite(.2,.9,.2,std(0xffc81a),0,-.45,s*.6,pied);boite(.6,.08,.6,Kn,0,-.9,s*.6,pied);stabK.push({bm:bm,pied:pied,s:s})});
  /* grue articulée (pied tournant + deux bras) */
  var GL1=6,GL2=5.5,tourK=new T.Group();tourK.position.set(4.3,1.2,0);K.add(tourK);var Gj=std(0xffc81a,{roughness:.45,metalness:.3});
  cyl(.55,.65,.5,Kn,0,.25,0,tourK,16);cyl(.32,.36,1.4,Gj,0,1.1,0,tourK,16);
  var gf1=new T.Group();gf1.position.y=1.8;tourK.add(gf1);boite(GL1,.42,.42,Gj,GL1/2,0,0,gf1);var ve3=cyl(.07,.07,3,Bc,1.6,-.35,0,gf1,8);ve3.rotation.z=Math.PI/2;
  var gf2=new T.Group();gf2.position.x=GL1;gf1.add(gf2);boite(GL2,.34,.34,Gj,GL2/2,0,0,gf2);boite(GL2*.6,.26,.26,Gj,GL2*.75,0,0,gf2);
  var crochet=new T.Group();scene.add(crochet);boite(.35,.45,.25,std(0xffc81a),0,.22,0,crochet);mesh(new T.TorusGeometry(.14,.04,8,16,Math.PI*1.4),Bc,0,-.12,0,crochet);
  var cable=mesh(new T.CylinderGeometry(.02,.02,1,6),std(0x222222),0,0,0,scene,false);
  var elingues=[];for(i=0;i<4;i++){var el=mesh(new T.CylinderGeometry(.018,.018,1,5),std(0xe11d48,{roughness:.6}),0,0,0,scene,false);el.visible=false;elingues.push(el)}
  var GREPOS=new T.Vector3(.6,3.3,0),grue={t:new T.Vector3(),c:1.2,sw:new T.Vector2(),swv:new T.Vector2(),tipPrec:new T.Vector3(),charge:null,actif:false};
  function piedGrue(){return tourK.localToWorld(new T.Vector3(0,1.8,0))}
  function ikGrue(){if(!grue.actif)K.localToWorld(grue.t.copy(GREPOS));var P=piedGrue(),dx=grue.t.x-P.x,dz=grue.t.z-P.z,r=Math.max(.5,Math.hypot(dx,dz)),th=Math.atan2(-dz,dx);tourK.rotation.y=th-K.rotation.y;
    var ty=grue.t.y-P.y,D=Math.min(Math.hypot(r,ty),GL1+GL2-.02),c2=(D*D-GL1*GL1-GL2*GL2)/(2*GL1*GL2),t2=-Math.acos(clamp(c2,-1,1)),phi=Math.atan2(ty,r),
      t1=phi-Math.atan2(GL2*Math.sin(t2),GL1+GL2*Math.cos(t2));gf1.rotation.z=t1;gf2.rotation.z=t2}
  function majCrochet(dt){K.updateMatrixWorld(true);var tip=gf2.localToWorld(new T.Vector3(GL2,0,0));
    if(dt>0){var ax=(tip.x-grue.tipPrec.x)/dt,az=(tip.z-grue.tipPrec.z)/dt;grue.swv.x+=(-6*grue.sw.x-1.6*grue.swv.x-ax*.35)*dt;grue.swv.y+=(-6*grue.sw.y-1.6*grue.swv.y-az*.35)*dt;grue.sw.addScaledVector(grue.swv,dt)}
    grue.tipPrec.copy(tip);crochet.position.set(tip.x+grue.sw.x,tip.y-grue.c,tip.z+grue.sw.y);
    var haut=V2.copy(crochet.position).add(V3.set(0,.45,0));cable.position.copy(tip).add(haut).multiplyScalar(.5);cable.scale.y=Math.max(.01,tip.distanceTo(haut));
    cable.quaternion.setFromUnitVectors(V3.set(0,1,0),V.copy(tip).sub(haut).normalize());
    if(grue.charge&&elingues[0].visible){var c=grue.charge,hl=c.userData.L*.4;[[-hl,.4],[hl,.4],[-hl,-.4],[hl,-.4]].forEach(function(o,k){var a=c.localToWorld(V3.set(o[0],c.userData.H,o[1])),b=crochet.position,e=elingues[k];
      e.position.copy(a).add(b).multiplyScalar(.5);e.scale.y=a.distanceTo(b);e.quaternion.setFromUnitVectors(V2.set(0,1,0),V.copy(b).sub(a).normalize())})}}
  function grueVers(p,d,ez){var P=piedGrue(),a0=Math.atan2(grue.t.z-P.z,grue.t.x-P.x),r0=Math.hypot(grue.t.x-P.x,grue.t.z-P.z),h0=grue.t.y,
      a1=Math.atan2(p[2]-P.z,p[0]-P.x),r1=Math.hypot(p[0]-P.x,p[2]-P.z);while(a1-a0>Math.PI)a1-=Math.PI*2;while(a1-a0<-Math.PI)a1+=Math.PI*2;grue.actif=true;
    return tw(d,function(k){var a=a0+(a1-a0)*k,r=r0+(r1-r0)*k;grue.t.set(P.x+Math.cos(a)*r,h0+(p[1]-h0)*k,P.z+Math.sin(a)*r)},ez||io)}
  function cableVers(c,d){var c0=grue.c;return tw(d,function(k){grue.c=c0+(c-c0)*k},io)}
  var cinq=prix('5',matOr),Hc=cinq.userData.H;cinq.rotation.y=Math.PI;K.add(cinq);cinq.position.set(-3.2,1.28,0);
  var sangles=[];[-1.2,1.2].forEach(function(x){sangles.push(boite(.12,Hc+.06,1.26,std(0xff7a00,{roughness:.7}),-3.2+x,1.28+Hc/2,0,K))});
  [-4.8,-1.6].forEach(function(x){boite(.4,.18,1.6,std(0x8b5a2b,{roughness:.9}),x,1.32,0,K)});
  var chauffeur=Humain({haut:0x2d2a3a,cheveux:0x3a2a1a});chauffeur.g.position.set(6.4,1.25,.55);chauffeur.g.rotation.y=Math.PI/2;assis(chauffeur);K.add(chauffeur.g);
  K.position.set(68,0,9.5);K.rotation.y=Math.PI;scene.updateMatrixWorld(true);ikGrue();
  var tenue5=new T.Group();tenue5.position.set(0,.6,0);scene.add(tenue5);

  /* --------------------------------------------------------------- les gens */
  var ouvrier=Humain({gilet:0xff6a00,casque:0xffc81a,haut:0x3a3f5c,gants:true}),chef=Humain({gilet:0xd4ff2a,casque:0xffffff,haut:0x1f2937,bas:0x1f2937,gants:true});
  ouvrier.g.position.set(-14.6,0,-7.6);chef.g.position.set(-14.6,0,-8.4);ouvrier.g.rotation.y=chef.g.rotation.y=Math.PI/2;scene.add(ouvrier.g,chef.g);ouvrier.g.visible=chef.g.visible=false;
  boite(.05,.14,.03,std(0x111111),0,-.06,.05,chef.J.gm);
  var masse=new T.Group();cyl(.024,.024,.9,std(0x7a4a22,{roughness:.8}),0,-.38,0,masse,8);boite(.13,.13,.34,std(0x4b5263,{metalness:.8,roughness:.35}),0,-.82,0,masse);
  ouvrier.c.add(masse);masse.position.set(.05,1.3,-.2);masse.rotation.set(0,0,2.5);
  var balai=new T.Group();cyl(.018,.018,1.4,std(0xc08a4a),0,-.65,0,balai,6);boite(.5,.07,.12,std(0x7a4a22),0,-1.36,0,balai);boite(.48,.14,.09,std(0xe8c15a,{roughness:1}),0,-1.46,0,balai);balai.visible=false;
  var gens=[ouvrier,chef],passants=[],marcheurs=[];
  var habits=[{haut:0x6d28d9,bas:0x1f2937,cheveux:0x2a1a12},{haut:0xe5e7eb,bas:0x334155,cheveux:0xd6b38a,long:true},{haut:0x7f1d1d,bas:0x111827,cheveux:0x111111,tel:true,manteau:true},
    {haut:0x0f766e,bas:0x3f3f46,cheveux:0x5a3a22,bonnet:0x9333ea},{haut:0x1e3a8a,bas:0x111111,cheveux:0x2a1a12,tel:true,peau:0x8d5a3b},{haut:0xa16207,bas:0x27272a,cheveux:0x3b2a1a,long:true,peau:0xe0b08a},
    {haut:0x9d174d,bas:0x18181b,cheveux:0x111111,peau:0x6b4226,manteau:true},{haut:0x52525b,bas:0x1c1917,cheveux:0x9ca3af}];
  [[-8.2,-16.5],[-6.6,-16.3],[-3.4,-16.6],[1.6,-16.4],[3,-16.7],[6.2,-16.4],[8.6,-16.6]].forEach(function(p,k){var h=Humain(habits[k%habits.length]);h.g.position.set(p[0],0,p[1]);
    h.g.rotation.y=hasard(-.25,.25);h.s.regard=new T.Vector3(0,1.8,0);h.g.scale.setScalar(hasard(.92,1.06));scene.add(h.g);passants.push(h);gens.push(h);
    if(h.tel){h.J.da.rotation.x=-1.7;h.J.de.rotation.x=-.6}});
  for(i=0;i<5;i++){var hm=Humain(habits[(i+3)%habits.length]),sens=i%2?1:-1;hm.g.position.set(hasard(-40,40),0,sens>0?-18.4:-17.2);hm.g.rotation.y=sens*Math.PI/2;hm.s.bouge=true;hm.s.v=hasard(1.1,1.5);
    hm.sens=sens;scene.add(hm.g);marcheurs.push(hm);gens.push(hm)}

  /* --------------------------------------------------------------- caméra */
  var C={p:new T.Vector3(40,26,52),l:new T.Vector3(0,1.5,0),suit:null,sec:0};
  function cam(p,l,d,ez){var p0=C.p.clone(),l0=C.l.clone(),p1=v3(p),l1=v3(l);C.suit=null;return tw(d,function(k){C.p.lerpVectors(p0,p1,k);C.l.lerpVectors(l0,l1,k)},ez)}
  function coupe(p,l){C.suit=null;C.p.copy(v3(p));C.l.copy(v3(l))}
  function suis(obj,off,lo,lis){C.suit={o:obj,off:v3(off),lo:v3(lo||[0,1,0]),lis:lis||3}}
  function secoue(a){C.sec=Math.max(C.sec,a)}
  function pose(h,cibles,d,ez){var de={};Object.keys(cibles).forEach(function(k){var a=k.split('.');de[k]=h.J[a[0]].rotation[a[1]]});
    return tw(d,function(p){Object.keys(cibles).forEach(function(k){var a=k.split('.');h.J[a[0]].rotation[a[1]]=de[k]+(cibles[k]-de[k])*p})},ez)}
  function tourne(h,x,z,d){var a0=h.g.rotation.y,a1=Math.atan2(x-h.g.position.x,z-h.g.position.z);while(a1-a0>Math.PI)a1-=Math.PI*2;while(a1-a0<-Math.PI)a1+=Math.PI*2;
    return tw(d||.25,function(p){h.g.rotation.y=a0+(a1-a0)*p})}
  function marche(h,pts,v){var P=[h.g.position.clone().setY(0)].concat(pts.map(function(p){return new T.Vector3(p[0],0,p[1])})),cu=P.length>2?new T.CatmullRomCurve3(P,false,'centripetal'):new T.LineCurve3(P[0],P[1]),L=cu.getLength();
    if(L<.05)return attends(0);h.s.bouge=true;h.s.v=v||1.6;
    return tw(L/h.s.v,function(u){var p=cu.getPointAt(u),t=cu.getTangentAt(Math.min(u,.999));h.g.position.set(p.x,0,p.z);var a=Math.atan2(t.x,t.z),a0=h.g.rotation.y;
      while(a-a0>Math.PI)a-=Math.PI*2;while(a-a0<-Math.PI)a+=Math.PI*2;h.g.rotation.y=a0+(a-a0)*.25},lin).then(function(){h.s.bouge=false})}
  function auMonde(o){scene.attach(o)}
  function prends(o,parent,pos,rot,d){parent.attach(o);var p0=o.position.clone(),r0=o.rotation.clone(),p1=v3(pos);
    return tw(d||.3,function(k){o.position.lerpVectors(p0,p1,k);o.rotation.set(r0.x+(rot[0]-r0.x)*k,r0.y+(rot[1]-r0.y)*k,r0.z+(rot[2]-r0.z)*k)})}

  /* --------------------------------------------------------------- halo lumineux */
  var composer=null,bloom=null;
  if(T.EffectComposer&&T.UnrealBloomPass){try{composer=new T.EffectComposer(renderer);composer.setPixelRatio&&composer.setPixelRatio(DPR);composer.setSize(W,H);
    composer.addPass(new T.RenderPass(scene,camera));bloom=new T.UnrealBloomPass(new T.Vector2(W,H),.75,.55,.86);composer.addPass(bloom)}catch(e){composer=null}}
  function taille(){W=innerWidth;H=innerHeight;camera.aspect=W/H;camera.updateProjectionMatrix();renderer.setSize(W,H);if(composer)composer.setSize(W,H);
    var s=H*DPR/(2*Math.tan(camera.fov*Math.PI/360));poussiere.mat.uniforms.uScale.value=etinc.mat.uniforms.uScale.value=s}
  taille();addEventListener('resize',taille);

  /* --------------------------------------------------------------- sons des véhicules */
  var mTracto=son.emetteur(son.diesel(44)),mCamion=son.emetteur(son.diesel(30)),mPilote=son.emetteur(son.diesel(70)),mHydro=son.emetteur(son.hydraulique||function(){}),
      bipT=0,recul=null,hydro=0,hydroPos=B.position,niv={tracto:0,camion:0,pilote:0},trem=null;

  /* --------------------------------------------------------------- boucle d'animation */
  function majHumain(h,dt){var J=h.J,s=h.s;
    if(s.bouge){s.ph+=dt*s.v*3.4;var sn=Math.sin(s.ph);J.gx.rotation.x=-sn*.6;J.dx.rotation.x=sn*.6;J.gk.rotation.x=Math.max(0,Math.sin(s.ph-1.4));J.dk.rotation.x=Math.max(0,Math.sin(s.ph+1.74));
      if(s.brasLibres){J.ga.rotation.x=sn*.5;J.da.rotation.x=-sn*.5}h.c.position.y=Math.abs(Math.cos(s.ph))*.045;
      var sg=sn>0?1:-1;if(sg!==s.pas){s.pas=sg;if(h===ouvrier||h===chef)son.pas(h.g.position)}}
    else{var k=Math.pow(.001,dt);J.gx.rotation.x*=k;J.dx.rotation.x*=k;J.gk.rotation.x*=k;J.dk.rotation.x*=k;h.c.position.y=h.c.position.y*k+Math.sin(st*2+s.idle)*.004*(1-k)}
    if(s.regard){h.g.updateMatrixWorld();var l=h.g.worldToLocal(V.copy(s.regard)),ya=clamp(Math.atan2(l.x,l.z),-1.1,1.1),pi=clamp(-Math.atan2(l.y-1.7,Math.hypot(l.x,l.z)),-.5,.5);
      J.t.rotation.y+=(ya-J.t.rotation.y)*Math.min(1,dt*4);J.t.rotation.x+=(pi-J.t.rotation.x)*Math.min(1,dt*4)}}
  function boucle(now){var rd=Math.min(.05,(now-last)/1000);last=now;var dt=rd*ts;st+=dt;
    var L=TW.slice();for(var i=0;i<L.length;i++){var w=L[i],p=(st-w.t0)/w.d;if(p>=1){TW.splice(TW.indexOf(w),1);if(w.fn)w.fn(1);w.r()}else if(w.fn)w.fn(w.ez(p))}
    if(fini)return;
    if(trem){var k=Math.min(1,(st-trem.t0)/trem.d);if(st>=trem.n){var A=.02+.38*k*k;trem.n=st+.016+.14*(1-k)*(1-k);
        dix.position.set((Math.random()-.5)*A,(Math.random()-.5)*A*.6,(Math.random()-.5)*A*.4);dix.rotation.z=(Math.random()-.5)*.12*k}
      tenue.scale.setScalar(1+1.1*k*k*k);tenue.position.set(0,.6+k*k*2.2,k*k*k*6);if(k>.45)secoue(.06*k);if(bloom)bloom.strength=.75+k*1.6;lumPrix.intensity=k*3}
    gens.forEach(function(h){majHumain(h,dt)});
    marcheurs.forEach(function(h){if(h.arret)return;h.g.position.x+=h.sens*h.s.v*dt;if(Math.abs(h.g.position.x)>46)h.g.position.x=-h.sens*46});
    voitures.forEach(function(c){c.g.position.x+=c.d*c.v*dt;if(Math.abs(c.g.position.x)>110){c.g.position.x=-c.d*110;c.son=false}
      if(!c.son&&Math.abs(c.g.position.x-C.p.x)<22){c.son=true;if(Math.abs(C.p.z-c.g.position.z)<60)son.voiturePasse(c.d)}});
    var fl=(Math.sin(st*18)>0)?1:0,fl2=(Math.sin(st*15+1)>0)?1:0;gy.rotation.y+=dt*9;gyro.emissiveIntensity=1+fl*3;gyK.emissiveIntensity=.5+fl2*3.5;pilote.gyro.emissiveIntensity=.5+fl*3.5;
    lampes.forEach(function(b){b.userData.lampe.emissiveIntensity=Math.sin(st*7+b.userData.ph)>0?3:.2});
    clignotants.forEach(function(l){l.visible=Math.sin(st*3+(l.userData.cl||0))>0});
    nuages.forEach(function(n){n.position.applyAxisAngle(V.set(0,1,0),dt*.004*n.userData.v);n.lookAt(0,n.position.y*.3,0)});
    oiseaux.forEach(function(o){var u=o.userData,a=st*.05+u.k*.05;o.position.set(Math.cos(a)*150-40+(u.k%3)*4,60+(u.k%4)*3+Math.sin(st+u.k)*.5,-120+Math.sin(a)*40+(u.k>>1)*3);
      o.rotation.y=-a;var f=Math.sin(st*9+u.k)*.6;u.a.rotation.z=f;u.b.rotation.z=-f});
    galTex.rotation+=dt*.012;
    var mp=motes.geometry.attributes.position,mb=motes.userData.base;for(var mi=0;mi<mp.count;mi++){mp.array[mi*3]=mb[mi*3]+Math.sin(st*.3+mi)*.6;mp.array[mi*3+1]=mb[mi*3+1]+Math.sin(st*.21+mi*1.7)*.4}mp.needsUpdate=true;
    if(niv.tracto){V.set(1.2,4.1,.6);B.localToWorld(V);if(Math.random()<dt*14)poussiere.jet(V,V2.set(hasard(-.15,.15),1.6+Math.random(),hasard(-.15,.15)),2.2,.5,0x2a2630,.5,-.3,.97,4)}
    if(niv.camion){V.set(5.2,3.9,.85);K.localToWorld(V);if(Math.random()<dt*12)poussiere.jet(V,V2.set(hasard(-.15,.15),1.8+Math.random(),hasard(-.15,.15)),2.4,.6,0x2a2630,.45,-.3,.97,4)}
    mTracto.maj(B.position,niv.tracto*.9);mTracto.rpm(1+(tracto.vit?.5:0)+hydro*.4);mCamion.maj(K.position,niv.camion*1.1);mCamion.rpm(1+(camion.vit?.6:0)+(grue.actif?hydro*.3:0));
    mPilote.maj(pilote.g.position,niv.pilote*.5);mHydro.maj(hydroPos,hydro*.35);
    if(recul){bipT-=rd;if(bipT<0){bipT=.9;son.bip(recul.position)}}
    ikBras();ikGrue();majCrochet(dt);
    poussiere.maj(dt);etinc.maj(dt);majFrags(dt);son.maj(rd);
    if(C.suit){var o=C.suit.o.getWorldPosition(V2).clone(),f=1-Math.exp(-rd*C.suit.lis);C.p.lerp(o.clone().add(C.suit.off),f);C.l.lerp(o.add(C.suit.lo),f)}
    camera.position.copy(C.p);camera.position.x+=Math.sin(st*.9)*.04+Math.sin(st*2.3)*.015;camera.position.y+=Math.sin(st*1.3)*.03;
    if(C.sec>.001){camera.position.x+=(Math.random()-.5)*C.sec;camera.position.y+=(Math.random()-.5)*C.sec;C.sec*=Math.pow(.02,rd)}
    camera.lookAt(C.l);camera.updateMatrixWorld();
    if(composer)composer.render();else renderer.render(scene,camera);
    raf=requestAnimationFrame(boucle)}

  /* --------------------------------------------------------------- fin / passer */
  function fermer(){if(fini)return;fini=true;cancelAnimationFrame(raf);removeEventListener('resize',taille);document.removeEventListener('keydown',touche);son.stop();
    ov.remove();document.documentElement.style.overflow='';try{renderer.dispose();renderer.forceContextLoss()}catch(e){}opt.fin()}
  function touche(e){if(e.key==='Escape'||e.key==='Enter'||e.key===' '){e.preventDefault();fermer()}}
  ov.addEventListener('click',fermer);document.addEventListener('keydown',touche);

  /* =============================================================== LE FILM */
  function reaction(){passants.forEach(function(h,k){attends(k*.05).then(function(){return pose(h,{'ga.x':-2.6,'da.x':h.tel?-1.7:-2.6,'ge.x':-1.2,'de.x':h.tel?-.6:-1.2},.25,oc)})
    .then(function(){return attends(hasard(.8,1.4))}).then(function(){return pose(h,{'ga.x':0,'da.x':h.tel?-1.7:0,'ge.x':0,'de.x':h.tel?-.6:0},.6)})});
    marcheurs.forEach(function(h){if(Math.abs(h.g.position.x)>18)return;h.arret=true;h.s.bouge=false;h.s.regard=new T.Vector3(0,1.8,0);tourne(h,0,0,.4)})}
  function applaudir(d){son.applaudir(1);var fin=st+d;passants.forEach(function(h){if(h.tel)return;(function clap(){if(fini||st>fin)return pose(h,{'ga.x':0,'da.x':0,'ga.z':0,'da.z':0},.4);
      pose(h,{'ga.x':-1.2,'da.x':-1.2,'ga.z':-.5,'da.z':.5},.12).then(function(){return pose(h,{'ga.z':-.25,'da.z':.25},.12)}).then(clap)})()});
    attends(d).then(function(){son.applaudir(0)})}
  var balaie=false;
  function outilBalai(on){if(on){chef.J.de.add(balai);balai.visible=true;balai.position.set(0,-.05,0);balai.rotation.set(-.2,0,0);chef.s.brasLibres=false;balaie=true;return pose(chef,{'da.x':-.55,'ga.x':-.5,'ge.x':-.6},.3)}
    balaie=false;balai.visible=false;chef.s.brasLibres=true;return pose(chef,{'da.x':0,'da.z':0,'ga.x':0,'ge.x':0},.3)}
  async function film(){var k,b,p,f,x;
    son.foule(.5);setTimeout(function(){ov.classList.add('on')},50);
    /* 1. La ville, le chantier, les passants */
    cam([16,7,26],[0,1.5,0],4,io);await attends(.8);q('.titre').classList.add('on');await attends(2.2);q('.titre').classList.remove('on');await attends(1);
    /* 2. Le 10 € tremble de plus en plus vite et sort de l'écran ; les passants regardent */
    cap('Anomalie détectée…');coupe([0,2.4,10],[0,2.2,0]);trem={t0:st,d:3.6,n:0};cam([0,2.3,6.4],[0,2.3,0],3.6,ic);
    await attends(1.6);coupe([2.5,1.75,-10.6],[0,1.6,-16.5]);await attends(1.1);coupe([0,2.3,8.2],[0,2.3,0]);cam([0,2.3,6.4],[0,2.3,0],.9,ic);await attends(.9);
    trem=null;var s0=tenue.scale.x,y0=tenue.position.y,z0=tenue.position.z;dix.position.set(0,0,0);dix.rotation.z=0;
    await tw(.35,function(p){tenue.scale.setScalar(s0+(1-s0)*p);tenue.position.set(0,y0+(.6-y0)*p,z0*(1-p))},ic);
    son.boom(tenue.position);secoue(.9);flash(.45);nuage(new T.Vector3(0,.4,1.4),40,7,0x8f7f70,2.4);gerbe(new T.Vector3(0,.7,1.4),60,9);son.ooh();lumPrix.intensity=0;
    if(bloom)tw(.8,function(p){bloom.strength=2.4-(2.4-.75)*p});cam([0,4.6,16],[0,2,0],.9,oc);await attends(1.2);
    /* 3. Les ouvriers sortent du bungalow et installent le périmètre */
    cap('Mise en sécurité du chantier');son.porte(V.set(-15,1,-8));ouvrier.g.visible=chef.g.visible=true;
    coupe([-9,2.2,-1],[-15,1.2,-7.6]);cam([-7.5,2.6,-1.5],[-13,1,-6],2.5,io);
    /* les deux ouvriers posent les barrières en même temps (la première en temps réel, le reste en accéléré) */
    async function poser(h,k,dernier){var ouest=h===chef,b=barrieres[ouest?pileOuest--:pileEst++],p=placesB[k],rte=routes[k];p.b=b;
      await marche(h,[[b.position.x+(ouest?-.95:.95),b.position.z]],1.6);await tourne(h,b.position.x,b.position.z,.15);h.s.brasLibres=false;
      await pose(h,{'c.x':.45,'ga.x':-1,'da.x':-1},.25);await prends(b,h.g,[0,.95,.55],[0,Math.PI/2,0],.2);await pose(h,{'c.x':0,'ga.x':-1.2,'da.x':-1.2,'ge.x':-.3,'de.x':-.3},.2);
      await marche(h,rte.slice(1),1.4);await tourne(h,p.x,p.z,.2);
      auMonde(b);(function(b0,r0){tw(.32,function(x){b.position.set(b0.x+(p.x-b0.x)*x,b0.y*(1-x),b0.z+(p.z-b0.z)*x);b.rotation.set(0,r0+(p.r-r0)*x,0)})})(b.position.clone(),b.rotation.y);
      await pose(h,{'c.x':.4},.3);son.thud(.4,b.position);nuage(new T.Vector3(p.x,.1,p.z),6,1.5,0x8f7f70,1);
      await pose(h,{'c.x':0,'ga.x':0,'da.x':0,'ge.x':0,'de.x':0},.2);h.s.brasLibres=true;
      if(!dernier)await marche(h,rte.slice(0,-1).reverse(),1.6)}
    await marche(ouvrier,[[-11.2,-6.6],[-10.4,-2.4]],1.6);cam([-5.2,2.8,7.5],[-9.5,1,.5],1.6,io);
    await poser(ouvrier,2);
    ts=12;q('.ff').classList.add('on');cam([0,15,19],[0,0,0],.6,io);
    await Promise.all([
      poser(ouvrier,0).then(function(){return poser(ouvrier,3,true)}).then(function(){return marche(ouvrier,[[-3.6,4.6],[8.8,4.4]],1.6)}),
      marche(chef,[[-14.5,-5],[-14.5,-1.5]],1.6).then(function(){return poser(chef,5)}).then(function(){return poser(chef,4)}).then(function(){return poser(chef,1,true)})
        .then(function(){return marche(chef,[[3.6,-5.0],[10.4,-5.0],[10.5,5.6]],1.6)}).then(function(){chef.s.regard=new T.Vector3(0,1.5,0);return tourne(chef,0,0)})]);
    for(k=0;k<plots.length;k++){(function(c){c.visible=true;tw(.25,function(p){c.scale.setScalar(.001+p);c.position.y=(1-p)*1.2},ic).then(function(){son.thud(.15,c.position)})})(plots[k]);await attends(.12)}
    await attends(.4);ts=1;q('.ff').classList.remove('on');
    /* 4. La tractopelle arrive et se gare en marche arrière (bip de recul) */
    cap('Arrivée de la tractopelle');niv.tracto=1;spotAR.intensity=2.5;faisAR.visible=true;
    coupe([24,1.3,16.5],[34,2,11]);suis(B,[-6,2.2,8],[0,1.6,0],1.6);
    ouvrier.s.regard=B.position;tourne(ouvrier,0,8);
    await roule(tracto,[[48,11],[-4,11]],6.5,{ez:oc});
    son.psst(B.position);await attends(.4);recul=B;coupe([9,2.6,16],[0,1.5,7]);
    await roule(tracto,[[-4,11],[0,11],[0,6.5]],2.4,{recul:true,bez:true});recul=null;son.psst(B.position);
    stabs.forEach(function(s){tw(.5,function(p){s.position.y=1.3-p*.32})});await attends(.5);son.thud(.5,B.position);secoue(.12);
    /* 5. L'ouvrier attaque à la masse, puis la tractopelle casse le 10 € */
    cap('Démolition du 10 €');ouvrier.s.regard=null;
    await marche(ouvrier,[[6.6,4.4],[6,2.2],[euroX+.7,1.95]],1.5);await tourne(ouvrier,euroX,.4,.2);
    cam([euroX+4.2,1.3,5.2],[euroX-.4,1.7,.3],.8,io);ouvrier.s.brasLibres=false;
    await pose(ouvrier,{'da.x':-1.2,'da.z':.4},.2);await prends(masse,ouvrier.J.de,[0,-.27,0],[0,0,0],.15);await pose(ouvrier,{'da.z':0},.1);
    for(k=0;k<3;k++){f=k/2;await pose(ouvrier,{'da.x':-3.0,'de.x':-.2,'c.x':-.15},.3,oc);await pose(ouvrier,{'da.x':-1.05,'de.x':0,'c.x':.25},.13,ic);
      var imp=new T.Vector3(euroX+.55,.6+Hn*.62,.6);son.clank(.7+f*.5,imp);gerbe(imp,30+k*15,6+k);nuage(imp,4,1.5,0x8f7f70,.6);secoue(.1+f*.15);matViolet.emissive.setHex(k>1?0x3c1290:0x2a0f66)}
    await pose(ouvrier,{'da.x':0,'c.x':0,'de.x':0},.3);ouvrier.c.attach(masse);masse.position.set(.05,1.3,-.2);masse.rotation.set(0,0,2.5);ouvrier.s.brasLibres=true;
    await marche(ouvrier,[[6,2.2],[6.6,4.4],[9.6,4.6]],2.4);ouvrier.s.regard=new T.Vector3(0,1.5,0);tourne(ouvrier,0,0);
    coupe([12.6,2,8.2],[10.4,1.7,5.6]);son.radio(chef.g.position);await pose(chef,{'da.x':-2.2,'de.x':-1.6},.3);await attends(.6);await pose(chef,{'da.x':0,'de.x':0,'ga.z':2.5},.3);son.whistle(chef.g.position);
    await pose(chef,{'ga.z':0},.3);
    cam([7,4,13],[0,2.3,0],1,io);hydro=1;hydroPos=B.position;
    await brasVers([euroX+.4,hautY+3.2,.2],1.2,0);
    for(k=0;k<3;k++){await brasVers([euroX+.2,hautY+.05,.2],.5,-.3,ic);var pt=pointeGodet();son.clank(1.3,pt);son.thud(1,pt);secoue(.4+k*.25);gerbe(pt,80,9);nuage(pt,10,3,0x8f7f70,1.3);flash(.2+k*.12);
      tenue.scale.y=1-.05*(k+1);if(k<2)await brasVers([euroX+.4,hautY+3,.2],.45,0,oc)}
    /* il se casse en 50 morceaux qui retombent sur la plateforme */
    cap('Le 10 € est cassé');tenue.visible=false;frags.forEach(function(f){f.m.visible=true;f.v.set(hasard(-1.2,1.2),hasard(.5,3),hasard(-1,1));f.w.set(hasard(-6,6),hasard(-6,6),hasard(-6,6))});
    var ctr=new T.Vector3(0,.6+Hn*.5,0);son.boom(ctr);son.clatter(2.4,ctr,1.4);son.ooh();reaction();flash(.6);secoue(1);gerbe(ctr,160,10);nuage(ctr,60,4,0x9a8a7a,2.6);
    if(bloom){bloom.strength=2.6;tw(1.4,function(p){bloom.strength=2.6-1.85*p})}
    ts=.3;coupe([euroX+5.5,1.3,6],[0,1.4,0]);await attends(.45);ts=1;cam([2,4,12],[0,1,0],.8,oc);await brasVers([2,hautY+3,2.4],1);
    coupe([2.5,1.75,-10.8],[0,1.6,-16.5]);await attends(1.4);
    /* 6. Évacuation des 50 morceaux dans la benne */
    cap('Évacuation des gravats');coupe([-4,7,15],[-2,1,2]);son.foule(.7);
    var colonnes=[4.2,1.4,-1.4,-4.2];
    for(k=0;k<colonnes.length;k++){if(k===1){ts=4;q('.ff').classList.add('on')}x=colonnes[k];
      await brasVers([x,3.4,-1.4],.8);await brasVers([x,.8,-1.1],.5,.5);
      await brasVers([x+.2,.8,1.2],.6,.6);frags.forEach(function(f){if(f.zone==='socle'&&f.m.visible&&(Math.abs(f.p.x-x)<1.5||k===colonnes.length-1)){f.zone='godet';godet.attach(f.m)}});
      son.clatter(.5,pointeGodet(),.8);await brasVers([x+.2,3.6,2],.6,-.1);await brasVers([BENNE.x,3.2,BENNE.z],1.1);
      await brasVers([BENNE.x,3,BENNE.z],.35,1.9);frags.forEach(function(f){if(f.zone==='godet'){scene.attach(f.m);f.zone='benne';f.repos=false;f.v.set(hasard(-.5,.5),0,hasard(-.5,.5))}});
      son.benne(V.set(BENNE.x,1,BENNE.z));nuage(V.set(BENNE.x,1.5,BENNE.z),12,2,0x8f7f70,1.4);await attends(.35);await brasVers([BENNE.x,3.4,BENNE.z],.3,0)}
    /* le chef balaie la poussière devant la plateforme ; la tractopelle replie son bras */
    ts=3;outilBalai(true);var trajet=marche(chef,[[10.5,4.6],[6.6,4.6],[6,2.1],[-1,2.0]],1.1);
    (function swish(){if(!balaie||fini)return;son.swish(chef.g.position);var bp=balai.localToWorld(new T.Vector3(0,-1.45,0));nuage(bp,3,1.2,0x9c8a78,.7);attends(.33).then(swish)})();
    tw(30,function(){if(balaie)chef.J.da.rotation.z=Math.sin(st*9)*.4},lin);
    coupe([6,2.6,-4.5],[2,.7,2]);suis(chef.g,[2.2,2.4,-5.5],[0,.6,1],1.6);hydro=.6;brasVers(null,1.6,0,io,true).then(function(){hydro=0});
    stabs.forEach(function(s){tw(.4,function(p){s.position.y=.98+p*.32})});
    await trajet;await outilBalai(false);ts=1;q('.ff').classList.remove('on');
    /* la tractopelle repart */
    cap('Départ de la tractopelle');cam([12,2.6,18],[2,1.5,9],1,io);
    marche(chef,[[-6,2.4],[-6.4,4.6],SO,[-9.6,7.3]],1.6).then(function(){chef.s.regard=new T.Vector3(10,1.5,9.5);return tourne(chef,0,9.5)});
    await roule(tracto,[[0,6.5],[.4,9.2],[3,11],[10,11],[34,11]],6,{ez:ic});niv.tracto=0;spotAR.intensity=0;faisAR.visible=false;
    B.position.set(400,0,60);B.visible=false;/* partie au loin : plus rien sur la route du convoi */
    /* 7. Le convoi exceptionnel apporte le 5 € */
    cap('Convoi exceptionnel');niv.pilote=1;niv.camion=1;coupe([22,1.6,15.5],[40,2.2,9.5]);suis(K,[-10,3,12],[2,2,0],1.4);
    marche(ouvrier,[[9.6,7.2]],1.4).then(function(){ouvrier.s.regard=K.position;return tourne(ouvrier,6,9.5)});
    roule(pilote,[[56,9.5],[-13,9.5]],9,{ez:oc});await roule(camion,[[68,9.5],[4,9.5]],9,{ez:oc});
    son.psst(K.position);niv.pilote=.4;await attends(.5);
    /* stabilisateurs puis grue */
    cap('Grutage du 5 €');coupe([14,2.2,17],[3,2.6,9.5]);hydro=1;hydroPos=K.position;
    await tw(1,function(p){stabK.forEach(function(s){s.bm.position.z=s.s*(.6+1.6*p);s.pied.position.z=s.s*1.6*p})});
    await tw(.6,function(p){stabK.forEach(function(s){s.pied.position.y=-.3*p})});son.thud(.5,K.position);
    cam([12,5,20],[3,3,8],1.2,io);var pc=K.localToWorld(new T.Vector3(-3.2,0,0));
    await grueVers([pc.x,7,pc.z],1.8);await cableVers(7-(1.28+Hc+1.5),1.2);son.chaine(crochet.position);
    await marche(ouvrier,[[pc.x+1.8,7.6]],1.2);await tourne(ouvrier,pc.x,pc.z,.2);await pose(ouvrier,{'ga.x':-2.6,'da.x':-2.6},.3);
    sangles.forEach(function(s){s.visible=false});son.sangle(pc);await attends(.3);
    grue.charge=cinq;crochet.attach(cinq);elingues.forEach(function(e){e.visible=true});son.sangle(pc);
    await pose(ouvrier,{'ga.x':0,'da.x':0},.3);await marche(ouvrier,[[9.6,7.2]],1.4);ouvrier.s.regard=crochet.position;
    await cableVers(grue.c-2,1.4);son.chaine(crochet.position);
    cam([-6,3,17],[1,4,4],1.4,io);chef.s.regard=crochet.position;passants.forEach(function(h){h.s.regard=crochet.position});await grueVers([0,7.2,0],3.2);
    coupe([0,2.6,7.4],[0,2.4,0]);await cableVers(7.2-(.6+Hc+1.5),2.2);
    /* posé ! */
    auMonde(cinq);elingues.forEach(function(e){e.visible=false});grue.charge=null;tenue5.add(cinq);cinq.position.set(0,0,0);cinq.rotation.set(0,0,0);
    son.thud(.8,tenue5.position);son.chime(tenue5.position);flash(.4);secoue(.3);gerbe(new T.Vector3(0,2,0),140,10);nuage(new T.Vector3(0,.5,1.3),24,4,0xd8c08a,1.8);
    lumPrix.color.setHex(0xffc75a);lumPrix.intensity=4;tw(1.4,function(p){lumPrix.intensity=4-2.5*p});if(bloom){bloom.strength=2.2;tw(1.4,function(p){bloom.strength=2.2-1.45*p})}
    passants.forEach(function(h){h.s.regard=new T.Vector3(0,1.8,0)});son.foule(.9);applaudir(3.5);
    /* 8. Accéléré : la grue se replie, le convoi repart, on enlève barrières et plots */
    cap('Fin du chantier');ts=5;q('.ff').classList.add('on');cam([2,13,22],[0,0,3],.8,io);
    await cableVers(1.2,.6);var rp=K.localToWorld(GREPOS.clone());await grueVers([rp.x,rp.y,rp.z],1.4);grue.actif=false;
    await tw(.5,function(p){stabK.forEach(function(s){s.pied.position.y=-.3*(1-p)})});await tw(.8,function(p){stabK.forEach(function(s){s.bm.position.z=s.s*(.6+1.6*(1-p));s.pied.position.z=s.s*1.6*(1-p)})});
    hydro=0;niv.pilote=1;
    roule(pilote,[[-13,9.5],[-70,9.5]],9,{ez:ic}).then(function(){niv.pilote=0});roule(camion,[[4,9.5],[-90,9.5]],8,{ez:ic}).then(function(){niv.camion=0});
    await marche(ouvrier,[[9,4.6]],1.6);
    var retrait=[[5,[[9,1.5],[8.5,0]]],[4,[[9,4.6],[3.6,4.6],[3.6,4.2]]],[3,[[-3.6,4.6],[-3.6,4.2]]],[2,[[-9,4.6],[-9,0],[-8.5,0]]],[0,[[-9,-4.6],[-3.6,-4.6],[-3.6,-4.2]]],[1,[[3.6,-4.6],[3.6,-4.2]]]];
    for(k=0;k<retrait.length;k++){p=placesB[retrait[k][0]];b=p.b;await marche(ouvrier,retrait[k][1],1.6);await tourne(ouvrier,p.x,p.z,.12);
      await pose(ouvrier,{'c.x':.45},.2);(function(bb){var y0=bb.position.y;tw(.35,function(x){bb.position.y=y0+x*1.2;bb.scale.setScalar(Math.max(.001,1-x))})})(b);son.thud(.15,b.position);await pose(ouvrier,{'c.x':0},.2)}
    plots.forEach(function(c){tw(.3,function(p){c.scale.setScalar(Math.max(.001,1-p))})});await attends(.5);
    ts=1;q('.ff').classList.remove('on');
    /* 9. Plan final sur le 5 € */
    cap('Réduction activée');ouvrier.s.regard=chef.s.regard=new T.Vector3(0,1.5,0);
    coupe([0,2.2,8],[0,2,0]);tw(4,function(p){var a=p*.7;C.p.set(Math.sin(a)*8,2.2+p*.6,Math.cos(a)*8)},lin);
    await attends(.9);q('.tp').classList.add('on');setTimeout(function(){son.stamp();secoue(.2)},300);son.applaudir(.5);
    await attends(2.6);son.applaudir(0);q('.fin').style.opacity=1;await attends(.7);fermer()}
  /* Préparation : la carte graphique compile les effets en arrière-plan (sans figer la page), puis le film démarre */
  var prep=document.createElement('div');prep.style.cssText='position:absolute;inset:0;z-index:5;display:grid;place-items:center;background:#05040d;color:#cbb8ff;font:600 clamp(.8rem,2vw,1.1rem) system-ui;letter-spacing:.3em;text-transform:uppercase';
  prep.textContent='Préparation de la cinématique…';ov.appendChild(prep);
  renderer.debug.checkShaderErrors=false;var gl=renderer.getContext(),ext=gl.getExtension('KHR_parallel_shader_compile'),t0prep=performance.now();
  frags.forEach(function(f){f.m.visible=true});tenue5.add(cinq.clone());[faisAR,balai].forEach(function(o){o.visible=true});
  renderer.compile(scene,camera);if(composer){composer.render()}else renderer.render(scene,camera);
  frags.forEach(function(f){f.m.visible=false});tenue5.clear();[faisAR,balai].forEach(function(o){o.visible=false});
  (function attendre(){if(fini)return;var progs=renderer.info.programs||[],faits=progs.filter(function(p){return !ext||gl.getProgramParameter(p.program,ext.COMPLETION_STATUS_KHR)}).length;
    prep.textContent='Préparation de la cinématique… '+Math.round(faits/Math.max(1,progs.length)*100)+' %';
    if(faits<progs.length&&performance.now()-t0prep<25000){setTimeout(attendre,100);return}
    prep.remove();last=performance.now();raf=requestAnimationFrame(boucle);film().catch(function(e){console.error(e);fermer()})})();
};
})();
