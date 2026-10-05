// Full-bleed map with a floating side panel on desktop; map on top and panel below on mobile.
function MapLayout({ map, children }) {
  return (
    <main className="relative lg:h-[calc(100vh-4rem)]">
      <div className="h-64 sm:h-80 lg:absolute lg:inset-0 lg:h-auto">{map}</div>
      <div className="relative z-10 -mt-4 px-3 pb-6 sm:px-6 lg:absolute lg:inset-y-0 lg:left-0 lg:mt-0 lg:w-[460px] lg:overflow-y-auto lg:p-5">
        <div className="rounded-2xl bg-white p-5 shadow-panel sm:p-6">{children}</div>
      </div>
    </main>
  );
}

export default MapLayout;
