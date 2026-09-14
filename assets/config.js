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
  kerf: 0.125,

  // Emergency contacts, shown when someone taps Emergency on the crew page.
  // Order matters: put the person to call first at the top.
  // "tel" is what actually gets dialed; digits, +, -, ( ) and spaces are fine.
  // A contact with no number is skipped. Leave the list empty to hide the button.
  emergencyContacts: [
    { name: 'Jay Figueroa',           role: 'Co-director',      tel: '+1 (254) 813-8239' },
    { name: 'Kaydee Free-Maldonado',  role: 'Co-director',      tel: '+1 (806) 773-3543' },
    { name: 'Nolan Maldonado',        role: 'Set designer',     tel: '+1 (254) 239-9040' },
    { name: 'Adrienne',               role: 'Theater director', tel: '' }
  ],

  // Where the shop is, shown on the emergency panel so callers can give an address.
  // Leave blank to hide it.
  shopAddress: ''
};
