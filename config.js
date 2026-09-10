/*
 * Settings shared by both pages. This is the only file you need to edit.
 */
window.CUT_CONFIG = {
  // Apps Script web app URL (ends in /exec). Leave blank to run in demo mode.
  apiUrl: '',

  // Shown at the top of both pages.
  title: 'Cut list',

  // Link to the Google Sheet, shown to leadership. Optional.
  sheetUrl: '',

  // How often pages check for other people's updates, in seconds.
  pollSeconds: 20,

  // Most pieces allowed in one taped bundle. Bigger lines split into several bundles.
  maxBundle: 10,

  // Saw blade kerf in inches, used for the lumber estimate.
  kerf: 0.125
};
