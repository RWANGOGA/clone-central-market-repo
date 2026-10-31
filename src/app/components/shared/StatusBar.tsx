/**
 * The mock iOS status bar — a fixed "9:41" clock, Wi-Fi/signal and battery
 * glyphs and a notch — used to be drawn at the top of every screen. It has been
 * removed app-wide: on a real handset the operating system already shows the
 * true time, connection and charge, so the fake only ever duplicated them and
 * cost every screen 47px of vertical space.
 *
 * The component is kept as a no-op so the pages that still render <StatusBar />
 * simply draw nothing, and the phone's own chrome is what the user sees.
 */
export default function StatusBar() {
  return null;
}
