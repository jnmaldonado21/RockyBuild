/*
 * Settings shared by both pages. This is the only file you need to edit.
 */
window.CUT_CONFIG = {
  // Apps Script web app URL (ends in /exec). Leave blank to run in demo mode.
  apiUrl: 'https://script.google.com/macros/s/AKfycbyWDZh48_ID7NmDZ_c8Fdoc3ZddowWmCumM8Nr4joOLjtoZymc-8dIkfB62oBjISs3p/exec',

  // Shown at the top of both pages.
  title: 'Voodoo Rocky',

  // Link to the Google Sheet, shown to leadership. Optional.
  sheetUrl: 'https://docs.google.com/spreadsheets/d/1vy4wBYnw-_KUMDkWAYzyNuMn_hKGyS53NAwbzO_Hsww/edit?gid=1412260922#gid=1412260922',

  // How often pages check for other people's updates, in seconds.
  pollSeconds: 20,

  // Most pieces allowed in one taped bundle. Bigger lines split into several bundles.
  maxBundle: 10,

  // Saw blade kerf in inches, used for the lumber estimate.
  kerf: 0.125
};
