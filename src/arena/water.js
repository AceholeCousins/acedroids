
var WATER_COLOR = new THREE.Color(0x1080ff); // will be overwritten by background color of outline in map svg
var WATER_OPACITY = 0.75; // so will this



// This is the 'compute shader' for the water bumpmap:
var bumpmapFragmentShader = `

	uniform float viscosityConstant;
	uniform float time;
	uniform vec4 disturbances [NDISTURBS]; //xy=position on water, z=depth, w=sigma

	#define deltaTime ( 1.0 / 60.0 )
	#define GRAVITY_CONSTANT ( resolution.x * deltaTime * 10.0 )

	void main()	{

		vec2 cellSize = 1.0 / resolution.xy;
		vec2 uv = gl_FragCoord.xy * cellSize;

		// bumpmapValue.x == height
		// bumpmapValue.y == velocity
		// bumpmapValue.z == reference height (disturbed by disturbances)
		// bumpmapValue.w == coast distance (negative in water)
		vec4 bumpmapValue = texture2D( bumpmap, uv );

		// Get neighbours
		vec4 N = texture2D( bumpmap, uv + vec2( 0.0, cellSize.y ) );
		vec4 S = texture2D( bumpmap, uv + vec2( 0.0, - cellSize.y ) );
		vec4 E = texture2D( bumpmap, uv + vec2( cellSize.x, 0.0 ) );
		vec4 W = texture2D( bumpmap, uv + vec2( - cellSize.x, 0.0 ) );

		vec4 NSEWd = clamp(-vec4(N.w, S.w, E.w, W.w) + 1.0, 0.01, 1.0);
		float sump = (NSEWd.x*(N.x-N.z) + NSEWd.y*(S.x-S.z) + NSEWd.z*(E.x-E.z) + NSEWd.w*(W.x-W.z))/(dot(NSEWd, vec4(1.0)))
					- (bumpmapValue.x-bumpmapValue.z);

		float accel = sump * GRAVITY_CONSTANT;

		// Dynamics
		bumpmapValue.y += accel;
		bumpmapValue.x += bumpmapValue.y * deltaTime;

		// Viscosity
		bumpmapValue.x += sump * viscosityConstant;
		bumpmapValue.x *= 0.999; // move towards 0

		float coastDamp = clamp(-bumpmapValue.w + 1.0, 0.01, 1.0);
		bumpmapValue.x *= coastDamp;
		bumpmapValue.y *= coastDamp;

		// disturbances
		bumpmapValue.z =
			+ 0.30118*sin(3.8006*time + -87.019*uv.x + -120.67*uv.y)
			+ 0.31303*sin(3.1302*time + -68.387*uv.x + 47.969*uv.y)
			+ 0.36896*sin(3.8314*time + 73.017*uv.x + -139.85*uv.y)
			+ 0.35293*sin(3.7046*time + 57.837*uv.x + -86.63*uv.y)
			+ 0.34859*sin(3.8219*time + -97.666*uv.x + 99.891*uv.y)
			+ 0.32156*sin(3.1244*time + 3.2101*uv.x + 18.612*uv.y)
			+ 0.34801*sin(3.5123*time + 4.7301*uv.x + -13.318*uv.y)
			+ 0.35282*sin(3.1819*time + 132.07*uv.x + -30.798*uv.y)
			+ 0.38279*sin(3.3018*time + -118.34*uv.x + 10.955*uv.y)
			+ 0.38524*sin(3.3936*time + -0.54873*uv.x + 7.6717*uv.y);
		bumpmapValue.z*=0.35;

		for(int i=0; i<NDISTURBS; i++){
			bumpmapValue.z -= disturbances[i].z*exp(-pow(distance(uv,disturbances[i].xy)*disturbances[i].w, 2.0));
		}

		gl_FragColor = bumpmapValue;

	}`;


var waterFragmentShader = `

	uniform vec3 lightvec;
	varying vec3 vNormal;
	varying vec3 pCam;
	varying vec3 pSurf;
	varying vec4 hmap;

	uniform vec4 waterColor;
	varying vec2 vuv;

	varying float waterdepth;

	void main()	{
/*
		vec2 distanceuv = vuv;
		if(terraindims.x > terraindims.y){distanceuv.y -= 0.5*(terraindims.x - terraindims.y)/terraindims.x;}
		else{distanceuv.x -= 0.5*(terraindims.y - terraindims.x)/terraindims.y;}
		vec4 distv4 = texture2D(distancetex, distanceuv);
		float dist = distv4.x*255.0 + distv4.y*255.0/256.0 + distv4.z*255.0/256.0/256.0 - 128.0;

		float waterdepth = -dist + hmap.x*0.1; // terrain depth (negative) + wave bump height
*/

		float waterdepth_outset = waterdepth+0.5;

		if(waterdepth_outset <= 0.0){
			gl_FragColor = vec4(0.0,0.0,0.0,0.0);
			return;
		}

		vec3 n = normalize(vNormal);
		vec3 light = normalize(lightvec); // direction TOWARDS light

		vec3 view = pSurf-pCam;
		vec3 reflectedView = normalize(view - 2.0*dot(view, n)*n);

		float wDiffuse = dot(n, light)*0.5+0.5;
		float wSpecular = dot(reflectedView, light);
		float wCoast = clamp(hmap.w-1.0, 0.0, 1.0);

		float specStart = 0.96;
		float specFull = 0.98;
		if(wSpecular<specStart){wSpecular = 0.0;}
		else if(wSpecular>specFull){wSpecular = 1.0;}
		else{wSpecular = 0.5-0.5*cos((wSpecular-specStart)/(specFull-specStart)*3.1416);}

		vec4 cAmbient = vec4(0.0,0.0,0.0,waterColor.w);
		vec4 cDiffuse = waterColor;
		vec4 cSpecular = waterColor;
		cSpecular.x += 0.25;
		if(cSpecular.x > 1.0){cSpecular.x = 1.0;}
		cSpecular.y += 0.25;
		if(cSpecular.y > 1.0){cSpecular.y = 1.0;}
		cSpecular.z += 0.25;
		if(cSpecular.z > 1.0){cSpecular.z = 1.0;}
		vec4 cCoast = cDiffuse;

		gl_FragColor = wCoast*cCoast + (1.0-wCoast) * (wSpecular*cSpecular + (1.0-wSpecular) * (wDiffuse*cDiffuse + (1.0-wDiffuse)*cAmbient));
		gl_FragColor.w *= clamp(waterdepth_outset*5.0, 0.0, 1.0);

	}`;

var waterVertexShaderCA = `// read water level from cellular automata

	uniform sampler2D bumpmap;
	uniform float time; // only needed in noCA version
	varying vec3 vNormal;
	varying vec3 pCam;
	varying vec3 pSurf;
	varying vec4 hmap;
	varying vec2 vuv;

	varying float waterdepth;

	void main() {

		vuv = uv;
		vec2 cellSize = vec2( 1.0 / WATER_CA_WIDTH, 1.0 / WATER_CA_WIDTH );

		// Compute normal from bumpmap
		vNormal = normalize(vec3(
			( texture2D( bumpmap, uv + vec2( - cellSize.x, 0 ) ).x - texture2D( bumpmap, uv + vec2( cellSize.x, 0 ) ).x ) * WATER_CA_WIDTH / WATER_BOUNDS,
			( texture2D( bumpmap, uv + vec2( 0, - cellSize.y ) ).x - texture2D( bumpmap, uv + vec2( 0, cellSize.y ) ).x ) * WATER_CA_WIDTH / WATER_BOUNDS,
			1.0 ));

		hmap = texture2D( bumpmap, uv );

		vec3 transformed = vec3( position.x, position.y, position.z );

		vNormal = (modelMatrix * vec4(vNormal,0.0)).xyz;
		pSurf = (modelMatrix * vec4(transformed,1.0)).xyz;

		pCam = cameraPosition;

		waterdepth = -hmap.w + hmap.x*0.1; // terrain depth (negative) + wave bump height

		gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed,1.0);
	}`;

var waterVertexShaderNoCA = `// generate water level

	uniform sampler2D bumpmap;
	uniform float time;
	varying vec3 vNormal;
	varying vec3 pCam;
	varying vec3 pSurf;
	varying vec4 hmap;
	varying vec2 vuv;

	varying float waterdepth;

	float h(vec2 r_){
		vec2 r=r_;
		return
			( 0.30118*sin(3.8006*time + -87.019*r.x + -120.67*r.y)
			+ 0.31303*sin(3.1302*time + -68.387*r.x + 47.969*r.y)
			+ 0.36896*sin(3.8314*time + 73.017*r.x + -139.85*r.y)
			+ 0.35293*sin(3.7046*time + 57.837*r.x + -86.63*r.y)
			+ 0.34859*sin(3.8219*time + -97.666*r.x + 99.891*r.y)
			+ 0.32156*sin(3.1244*time + 3.2101*r.x + 18.612*r.y)
			+ 0.34801*sin(3.5123*time + 4.7301*r.x + -13.318*r.y)
			+ 0.35282*sin(3.1819*time + 132.07*r.x + -30.798*r.y)
			+ 0.38279*sin(3.3018*time + -118.34*r.x + 10.955*r.y)
			+ 0.38524*sin(3.3936*time + -0.54873*r.x + 7.6717*r.y)) *0.6;
	}

	void main() {
		vuv = uv;

		vec2 cellSize = vec2( 1.0 / WATER_CA_WIDTH, 1.0 / WATER_CA_WIDTH );

		// Compute normal from bumpmap
		vNormal = normalize(vec3(
			( h( uv + vec2( - cellSize.x, 0 ) ) - h( uv + vec2( cellSize.x, 0 ) ) ) * WATER_CA_WIDTH / WATER_BOUNDS,
			( h( uv + vec2( 0, - cellSize.y ) ) - h( uv + vec2( 0, cellSize.y ) ) ) * WATER_CA_WIDTH / WATER_BOUNDS,
			1.0 ));

		hmap = vec4(h(uv),0.0,0.0, texture2D(bumpmap, uv).w);
		vec3 transformed = vec3( position.x, position.y, (h(uv) + 1.0)*0.03);
		//vec3 transformed = vec3( position.x, position.y, position.z );

		vNormal = (modelMatrix * vec4(vNormal,0.0)).xyz;
		pSurf = (modelMatrix * vec4(transformed,1.0)).xyz;

		pCam = cameraPosition;

		waterdepth = -hmap.w + hmap.x*0.1; // terrain depth (negative) + wave bump height

		gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed,1.0);
	}`;

var WATER_MATERIAL = {};

// Texture width for simulation
var WATER_CA_WIDTH = 128;
var NUM_TEXELS = WATER_CA_WIDTH * WATER_CA_WIDTH;

// Water size in system units
var WATER_BOUNDS = 300; // optional TODO: this parameter is still somewhat arbitrary
var WATER_BOUNDS_HALF = WATER_BOUNDS * 0.5;

var WATER_CA_GPU;
var WATER_BM_VAR; // water bumpmap variable
var WATER_UNIFORMS;

function initWater() {

	var geometry = new THREE.PlaneBufferGeometry( MAP_MAXDIM, MAP_MAXDIM, WATER_CA_WIDTH-1, WATER_CA_WIDTH-1 );

	var vertexShader = waterVertexShaderCA;
	if(!FANCY_WATER){vertexShader = waterVertexShaderNoCA;}

	// material: make a ShaderMaterial clone of MeshPhongMaterial, with customized vertex shader
	WATER_MATERIAL = new THREE.ShaderMaterial( {
		uniforms: {
			bumpmap: { type: 't', value: null }, // waves
			time: { type: 'f', value: 0 },
			lightvec: { type: 'v3', value: LIGHT_VECTOR }, // direction TOWARDS light
			// optional TODO: the light looks corner-ish when it comes from (1,1,1) which makes no sense
			// that doesn't hurt now because it comes from (-1,1,1) but still!
			// update: could be the orientation of the triangle split of the water tiles but that does
			// not explain why there is zero corneriness in the WATERTEST4
			waterColor: { type: 'v4', value: new THREE.Vector4(WATER_COLOR.r, WATER_COLOR.g, WATER_COLOR.b, WATER_OPACITY)}
			// make sure water color is set by arena loader
		},
		vertexShader: vertexShader,
		fragmentShader: waterFragmentShader,
		transparent: true
	} );

	// Defines
	WATER_MATERIAL.defines.WATER_CA_WIDTH = WATER_CA_WIDTH.toFixed( 1 );
	WATER_MATERIAL.defines.WATER_BOUNDS = WATER_BOUNDS.toFixed( 1 );

	WATER_UNIFORMS = WATER_MATERIAL.uniforms;

	var waterMesh = new THREE.Mesh( geometry, WATER_MATERIAL );
	//waterMesh.rotation.x = - Math.PI / 2;
	waterMesh.matrixAutoUpdate = false;
	waterMesh.updateMatrix();

	Scene.graphicsScene.add( waterMesh );

	// Creates the gpu computation class and sets it up

	WATER_CA_GPU = new THREE.GPUComputationRenderer( WATER_CA_WIDTH, WATER_CA_WIDTH, Scene.renderer );
	var bumpmap0 = WATER_CA_GPU.createTexture();
	fillWaterTexture( bumpmap0 );

	if(FANCY_WATER){

		WATER_BM_VAR = WATER_CA_GPU.addVariable( "bumpmap", bumpmapFragmentShader, bumpmap0 );

		WATER_CA_GPU.setVariableDependencies( WATER_BM_VAR, [ WATER_BM_VAR ] );

		WATER_BM_VAR.material.defines.NDISTURBS = 12;

		var disturbs = [];
		for(var i=0; i<WATER_BM_VAR.material.defines.NDISTURBS; i++){
			disturbs[i] = new THREE.Vector4( 1000, 1000, 3, 50 );
		}

		WATER_BM_VAR.material.uniforms.viscosityConstant = { type: "f", value: 0.03 };
		WATER_BM_VAR.material.uniforms.disturbances = { type: "v4v", value: disturbs};
		WATER_BM_VAR.material.uniforms.time = { type: "f", value: 0.0 };
		WATER_BM_VAR.material.defines.WATER_BOUNDS = WATER_BOUNDS.toFixed( 1 );


		var error = WATER_CA_GPU.init();
		if ( error !== null ) {
			console.error( error );
		}
	}
	else{
		WATER_UNIFORMS.bumpmap.value = bumpmap0;
	}
	/* // just a boring plane
	var geometry = new THREE.PlaneGeometry( MAP_WIDTH, MAP_HEIGHT, 1, 1);
	var material = new THREE.MeshBasicMaterial({
		color:WATER_COLOR,
		opacity:WATER_OPACITY,
		transparent:true});
	var water = new THREE.Mesh(geometry, material );
	water.renderOrder = RENDER_ORDER.water;
	water.position.z = 0;
	Scene.graphicsScene.add(water);
	*/
}

function fillWaterTexture( texture ) {

	var pixels = texture.image.data;

	var p = 0;
	for ( var j = 0; j < WATER_CA_WIDTH; j++ ) {
		for ( var i = 0; i < WATER_CA_WIDTH; i++ ) {

			var x = (i/(WATER_CA_WIDTH-1)-0.5) * MAP_MAXDIM;
			var y = (j/(WATER_CA_WIDTH-1)-0.5) * MAP_MAXDIM;

			var w = coastDistance(x,y,true);

		    pixels[ p + 0 ] = 0;
			pixels[ p + 1 ] = 0;
			pixels[ p + 2 ] = 0;
			pixels[ p + 3 ] = w;

			p += 4;
		}
	}
}

function updateWater(){

	WATER_MATERIAL.uniforms.time.value += DT;

	if(FANCY_WATER){
		//WATER_BM_VAR.material.uniforms.disturbances.value[1].x -=0.01;
		WATER_BM_VAR.material.uniforms.time.value += DT;

		for(i=0; i<WATER_BM_VAR.material.defines.NDISTURBS; i++){
			if(i<hovers.length){
				WATER_BM_VAR.material.uniforms.disturbances.value[i].x = hovers[i].body.position[0]/MAP_MAXDIM+0.5;
				WATER_BM_VAR.material.uniforms.disturbances.value[i].y = hovers[i].body.position[1]/MAP_MAXDIM+0.5;
				if(!hovers[i].hidden){
					WATER_BM_VAR.material.uniforms.disturbances.value[i].z =
						Math.sqrt(Math.pow(hovers[i].body.velocity[0],2) + Math.pow(hovers[i].body.velocity[1],2))*0.1+0.5;
				}
				else{
					WATER_BM_VAR.material.uniforms.disturbances.value[i].z = 0;
				}
			}
			else{
				WATER_BM_VAR.material.uniforms.disturbances.value[i].x = 1000.0;
				WATER_BM_VAR.material.uniforms.disturbances.value[i].y = 1000.0;
				WATER_BM_VAR.material.uniforms.disturbances.value[i].z = 0;
			}
		}

		// Do the gpu computation
		WATER_CA_GPU.compute();

		// Get compute output in custom uniform
		WATER_UNIFORMS.bumpmap.value = WATER_CA_GPU.getCurrentRenderTarget( WATER_BM_VAR ).texture;
	}
}
