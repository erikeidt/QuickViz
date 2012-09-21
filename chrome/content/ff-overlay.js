QuickViz.onFirefoxLoad = function(event) {
  document.getElementById("contentAreaContextMenu")
          .addEventListener("popupshowing", function (e){ QuickViz.showFirefoxContextMenu(e); }, false);
};

QuickViz.showFirefoxContextMenu = function(event) {
  // show or hide the menuitem based on what the context menu is on
  document.getElementById("context-QuickViz").hidden = gContextMenu.onImage;
};

window.addEventListener("load", function () { QuickViz.onFirefoxLoad(); }, false);
