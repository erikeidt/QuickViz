//
// Author: Erik L. Eidt
// Copyright (c) 2011,2012 Hewlett-Packard Development Company, L.P.
// All rights reserved.
// 
var QuickViz = {

  prefsBranch: null,

  panInsteadOfDrag : false,		// false is drag: mouse move moves document the same way; true is pan: mouse is moving toward stuff of interest (the reverse)
  wheelDirection : false,		// reverse sense of zoom/unzoom 
  wheelDelta : 1.06,			// wheel power sensitivity
  overSizeZ : 1.75,				// max allowed zoom taken as value from 1 meaning 1:1 or no zoom
  panDragFactor : 1.5,			// multiplies pan/drag mouse movement

  scrollbarPixelSize : 20,		// estimating size of scroll bars to allow normal scroll bar usage
  cancelAreaPixelSize : 16,		// if going within this number of pixels of the edge, then panning/dragging is cancelled

  toggle : false,				// pan/drag mode engaged by mousedown but not disengaged by mouseup; for debugging, mostly

  onLoad:
	function () {
		// initialization code
		this.initialized = true;
		this.strings = document.getElementById("QuickViz-strings");

		var b = Components.classes["@mozilla.org/preferences-service;1"]
                      .getService(Components.interfaces.nsIPrefService)
					.getBranch("extensions.QuickViz.");

		b.QueryInterface(Components.interfaces.nsIPrefBranch2);
		b.addObserver ( "", QuickViz, false );

		QuickViz.prefsBranch = b;
		QuickViz.observe ( null, "nsPref:changed", null );

		window.addEventListener ( "DOMContentLoaded", QuickViz.onPageLoad, false );
    },

  observe:
	function ( subject, topic, data ) {
		if ( topic == "nsPref:changed" ) {
			var q = QuickViz;
			var b = q.prefsBranch;

			q.panInsteadOfDrag	= b.getBoolPref ( "panInsteadOfDrag" );
			q.wheelDirection	= b.getBoolPref ( "reverseWheelDirection" );
			var i				= b.getIntPref ( "wheelSensitivity" );
			q.wheelDelta = 1 + i / 1000;
			i				= b.getIntPref ( "overSizeZ" );
			q.overSizeZ = 1 + i / 100;
			i				= b.getIntPref ( "mousemoveAmplify" );
			q.panDragFactor = 1 + i / 100;

/*
			alert (	"panInsteadOfDrag = "	+ q.panInsteadOfDrag	+ ";\r\n" +
					"wheelDirection = "	+ q.wheelDirection + ";\r\n" +
					"wheelDelta = " 	+ q.wheelDelta + ";\r\n" +
					"overSizeZ = "		+ q.overSizeZ + ";" );
*/
			// now what's left is to propogate the global prefs to all the open windows
			// but we're not going to bother with that...
			// ...let the user reload the windows
		}
	},


  onPageLoad: 
  	function ( evt ) {
		// debugger;
		// alert ( "evt" );
		if ( evt.originalTarget ) {
			var doc = evt.originalTarget;
			// if ( doc.nodeName != "#document" ) return;
			var tags = doc.getElementsByTagName("svg");
			if ( tags.length === 1 && doc.location ) {
				var loc = doc.location.toString();
				if ( loc.lastIndexOf("file:///", 0) === 0 && loc.indexOf(".svg", loc.length-4) !== 0 ) {
					// alert ( "found local .svg file:" + loc );
					// don't mess with .svg's that have scripts...
					var scrpts = doc.getElementsByTagName("script");
					if ( scrpts.length === 0 && doc.documentElement ) {
						// alert ( "no scripts" );
						var docElem = doc.documentElement;
						var win = doc.defaultView;

						var q = QuickViz;

						var that = q.newSVGState ( q, doc, docElem, win );

						// doesn't get triggered; maybe doc would work instead of docElem...
						// but win works, so enough is enough
						// docElem.addEventListener ( "load", q.loadSVGAction, false );

						// It's too early to initialize: width and hieght are still functions, not values
						// So, we delay initialization until the win onload event.
						that.loadSVGAction    = q.loadSVGAction.bind ( that );
						win.addEventListener ( "load", that.loadSVGAction, false );

						that.mousedownAction	= q.mousedownAction.bind ( that );
						that.mouseupAction	= q.mouseupAction.bind ( that );
						that.mousemoveAction	= q.mousemoveAction.bind ( that );
						that.mouseoutAction	= q.mouseoutAction.bind ( that );
						that.mousewheelAction	= q.mousewheelAction.bind ( that );
						that.resizeAction	= q.resizeAction.bind ( that );
						that.clickAction	= q.clickAction.bind ( that );

						docElem.addEventListener ( "mousedown", that.mousedownAction, false );
						docElem.addEventListener ( "mouseup", that.mouseupAction, false );
						docElem.addEventListener ( "mousemove", that.mousemoveAction, false );
						docElem.addEventListener ( "mouseout", that.mouseoutAction, false );
						docElem.addEventListener ( "DOMMouseScroll", that.mousewheelAction, false );

						win.addEventListener ( "resize", that.resizeAction, false );
						win.addEventListener ( "click", that.clickAction, false );
					}
				}
			}
		}
	},
 
  loadSVGAction:
	function () {
		if ( ! this.initialized )
			this.q.initialize ( this );
	},

  newSVGState:
	function ( q, doc, docElem, win ) {
		var that = new Object;
		that.q = q;
		that.initialized = false;
		that.doc = doc;
		that.docElem = docElem;
		that.win = win;
		that.totalZoom = 1;
		that.minZ = 1;
		that.maxZ = 1;
		that.resetCursor = false;
		that.drag = false;
		that.cancelClick = false;
		return that;
	},

  initialize:
	function ( that ) {
		var width = that.docElem.getAttribute ( "width" );
		that.viewBoxWidth = parseFloat ( width );

		var height = that.docElem.getAttribute ( "height" );
		that.viewBoxHeight = parseFloat ( height );

		that.initialized = true;

		that.q.computeEffectiveBoxAndMinMaxZ ( that );
		that.q.setZoom ( that, that.minZ, 0, 0 );		
	},

  computeEffectiveBoxAndMinMaxZ :
	function ( that ) {
		var wx = that.viewBoxWidth / that.win.innerWidth;
		var hy = that.viewBoxHeight / that.win.innerHeight;
		
		/*
		 * When an image is place into a window of a different aspect ratio,
		 * then there will be (usually invisible) white vertical bars: 
		 * 	on top & bottom just like black bars on tv viewing a widescreen movie 
		 *		-or-
		 * 	on left & right sides, just like on a widescreen tv when viewing 4:3 content.
		 * These white bars affect the way we need to communicate with the browser 
		 *	about scroll positioning and event location.
		 * So, we compute and use effectiveViewBox width and height.
		 */

		if ( wx > hy ) {
			// wx is 1:1
			if ( wx >= 1 )
				that.minZ = 1;		// don't go smaller than full window size
			else
				that.minZ = wx;		// don't go smaller than 1:1
			that.maxZ = wx * that.q.overSizeZ;	// allow a bit larger than 1:1
			that.effectiveViewBoxWidth = that.viewBoxWidth;
			that.effectiveViewBoxHeight = that.viewBoxHeight * wx / hy;
		}
		else {
			// hy is 1:1
			if ( hy >= 1 )
				that.minZ = 1;
			else
				that.minZ = hy;
			that.maxZ = hy * that.q.overSizeZ;
			that.effectiveViewBoxWidth = that.viewBoxWidth * hy / wx;
			that.effectiveViewBoxHeight = that.viewBoxHeight;
		}

/*
		alert ( 
			"wx = " + wx + "; hy = " + hy + ";\r\nmaxZ = " + that.maxZ + ";\r\n" +
			"vbw = " + that.viewBoxWidth + "; vbh = " + that.viewBoxHeight + ";\r\n" +
			"inw = " + that.win.innerWidth + "; inh = " + that.win.innerHeight + ";"
				 );
*/
	},

   setZoom:
	function ( that, z, evtX, evtY ) {
		var oldPxXPerPt = (that.win.scrollMaxX + that.win.innerWidth) / that.effectiveViewBoxWidth;   // / totalZoom;
		var oldPxYPerPt = (that.win.scrollMaxY + that.win.innerHeight) / that.effectiveViewBoxHeight; //  / totalZoom;

		var ptx = (that.win.pageXOffset + evtX) / oldPxXPerPt;
		var pty = (that.win.pageYOffset + evtY) / oldPxYPerPt;

		var z100 = Math.round ( z * 100 ) + "%";
		that.docElem.setAttributeNS ( null, "width", z100 );
		that.docElem.setAttributeNS ( null, "height", z100 );

		var newPxXPerPt = (that.win.scrollMaxX + that.win.innerWidth) / that.effectiveViewBoxWidth;   // / z;
		var newPxYPerPt = (that.win.scrollMaxY + that.win.innerHeight) / that.effectiveViewBoxHeight; // / z;

		var nwx = ptx * newPxXPerPt - evtX;
		var nwy = pty * newPxYPerPt - evtY;

		that.win.scrollTo ( nwx, nwy );

		that.totalZoom = z;
	},

  mousedownAction:
	function ( evt ) {
		if ( evt.preventDefault )
			evt.preventDefault ();

		evt.returnValue = false;

		if ( ! this.initialized )
			this.q.initialize ( this );

		if ( this.drag ) {
			this.docElem.style.cursor  = 'default';
			this.drag = false;
			if ( evt.stopPropagation )
				evt.stopPropagation ();
		}
		else if ( this.totalZoom > 1 ) {
			if ( evt.target.ownerDocument == this.docElem.ownerDocument /* evt.target.tagName == "svg" */ ) {
			 	// allow mouse clicks on scrollbars in the normal way...
				var w = this.q.scrollbarPixelSize;
				if ( evt.clientX < this.win.innerWidth - w && evt.clientY < this.win.innerHeight - w ) {
					this.drag = true;
					this.lastX = evt.clientX;
					this.lastY = evt.clientY;
			if ( evt.stopPropagation )
				evt.stopPropagation ();
				}
			}
		}
	},

  mouseupAction: 
	function ( evt ) { 
		if ( evt.preventDefault )
			evt.preventDefault ();

		evt.returnValue = false;

		if ( ! this.initialized )
			this.q.initialize ( this );

		if ( ! this.q.toggle && this.drag ) {
			this.docElem.style.cursor  = 'default';
			this.drag = false;
			if ( evt.stopPropagation )
				evt.stopPropagation ();
		}
	},

  mousemoveAction:
	function ( evt ) {
		if ( evt.preventDefault )
			evt.preventDefault ();

		evt.returnValue = false;

		if ( ! this.initialized )
			this.q.initialize ( this );

		if ( this.drag /* && evt.target == this.docElem */ ) {
			var x = evt.clientX;
			var y = evt.clientY;
			var w1 = this.q.cancelAreaPixelSize;
			var w2 = w1 + 6;
			if ( x <= w1 || y <= w1 || x >= this.win.innerWidth - w2 || y >= this.win.innerHeight - w2 ) {
				this.docElem.style.cursor = 'default';
				this.drag = false;
			}
			else {
				this.cancelClick = true;

				var difX = (this.lastX - x) * this.q.panDragFactor;
				var difY = (this.lastY - y) * this.q.panDragFactor;

				if ( this.q.panInsteadOfDrag ) {
					difX = -difX;
					difY = -difY;
				}

				difX += this.win.scrollX;
				difY += this.win.scrollY;

				var max = 0;
				if ( difX < 0 || difX > this.win.scrollMaxX )
					max = 1;
				if ( difY < 0 || difY > this.win.scrollMaxY )
					max += 2;

				if ( max == 0 )
					this.docElem.style.cursor = 'all-scroll';
				else if ( max == 1 ) 
					this.docElem.style.cursor = 'n-resize';
				else if ( max == 2 )
					this.docElem.style.cursor = 'w-resize';
				else if ( max == 3 )
					this.docElem.style.cursor = 'not-allowed';

				this.win.scrollTo ( difX, difY );

				this.lastX = evt.clientX;
				this.lastY = evt.clientY;
			}
		}
		else if ( this.resetCursor ) {
			this.docElem.style.cursor = 'default';
			this.resetCursor = false;
		}
	},

  mouseoutAction:
	function ( evt ) {
		if ( evt.preventDefault )
			evt.preventDefault ();

		evt.returnValue = false;

		if ( ! this.initialized )
			this.q.initialize ( this );

		if ( evt.target == this.docElem ) {
			if ( this.drag ) {
				var x = evt.clientX;
				var y = evt.clientY;
				var w1 = this.q.cancelAreaPixelSize;
				var w2 = w1 + 6;
				if ( x <= w1 || y <= w1 || x >= this.win.innerWidth - w2 || y > this.win.innerHeight - w2 ) {
					this.docElem.style.cursor = 'default';
					this.drag = false;
				}
			}
		}
	},

  mousewheelAction:
	function ( evt ) {
		if ( evt.preventDefault )
			evt.preventDefault ();

		evt.returnValue = false;

		if ( ! this.initialized )
			this.q.initialize ( this );

		if ( this.drag ) {
			this.docElem.style.cursor = 'default';
			this.drag = false;
		}

		var wheelMovement = evt.detail;
		if ( this.q.wheelDirection )
			wheelMovement = -wheelMovement;

		var scaleFactor = Math.pow ( this.q.wheelDelta, wheelMovement );
		var newZoom = scaleFactor * this.totalZoom;
		if ( newZoom < this.minZ ) {
			if ( this.totalZoom == this.minZ ) {
				/* if ( this.totalZoom != 1 ) {
					this.docElem.style.cursor = 'not-allowed';
					this.resetCursor = true;
				}
				else */ {
					// absence of scrollbars and return of cursor to default is deemed sufficient here
					if ( this.resetCursor ) {
						this.docElem.style.cursor = 'default';
						this.resetCursor = false;
					}
				}
				return;
			}
			else {
				newZoom = this.minZ;
			}
		}
		else if ( newZoom > this.maxZ ) {
			if ( this.totalZoom == this.maxZ ) {
				this.docElem.style.cursor = 'not-allowed';
				this.resetCursor = true;
				return;
			}
			else {
				newZoom = this.maxZ;
			}
		}

		this.docElem.style.cursor = 'crosshair';
		this.resetCursor = true;

		this.q.setZoom ( this, newZoom, evt.clientX, evt.clientY );
	},

  resizeAction:
	function ( evt ) {
		if ( ! this.initialized )
			this.q.initialize ( this );

		if ( this.drag ) {
			this.drag = false;
			this.docElem.style.cursor = 'default';
		}

		this.q.computeEffectiveBoxAndMinMaxZ ( this );

		if ( this.totalZoom > this.maxZ )
			this.q.setZoom ( this, this.maxZ, this.win.innerWidth / 4, this.win.innerHeight / 4 );
		else if ( this.totalZoom < this.minZ )
			this.q.setZoom ( this, this.minZ, this.win.innerWidth / 4, this.win.innerHeight / 4 );
	
	},

  clickAction:
	function ( evt ) {
		if ( this.cancelClick ) {
			this.cancelClick = false;

			if ( evt.preventDefault )
				evt.preventDefault ();

			evt.returnValue = false;

			if ( evt.stopPropagation )
				evt.stopPropagation ();
		}
	},

  onMenuItemCommand: 
	function ( evt ) {
		var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
							.getService(Components.interfaces.nsIPromptService);
		promptService.alert(window, this.strings.getString("helloMessageTitle"),
							this.strings.getString("helloMessage"));
	},

  onToolbarButtonCommand: 
	function ( evt ) {
		// just reuse the function above.  you can change this, obviously!
		QuickViz.onMenuItemCommand( evt );
	}

};

window.addEventListener ( "load", QuickViz.onLoad, true );

