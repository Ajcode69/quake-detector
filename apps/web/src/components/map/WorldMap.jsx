import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from "react-leaflet";
import { useEffect } from "react";
import { magToColor, magToRadius, getEventTime, timeAgo } from "../../utils";

function FitBounds({ events }) {
  const map = useMap();
  useEffect(() => {
    if (events.length === 0) return;
    const bounds = events
      .filter((e) => e.latitude && e.longitude)
      .map((e) => [parseFloat(e.latitude), parseFloat(e.longitude)]);
    if (bounds.length > 0) {
      try { map.fitBounds(bounds, { padding: [30, 30], maxZoom: 6 }); } catch {}
    }
  }, [events.length]);
  return null;
}

export default function WorldMap({ events = [], onSelectEvent, height = "100%", center, zoom, fitBounds = false }) {
  const validEvents = events.filter((e) => e.latitude && e.longitude);

  return (
    <MapContainer
      center={center || [20, 0]}
      zoom={zoom || 2}
      style={{ height, width: "100%", borderRadius: "8px" }}
      zoomControl={true}
      scrollWheelZoom={true}
      className="z-0"
    >
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://carto.com/">CARTO</a>'
        maxZoom={18}
      />

      {fitBounds && <FitBounds events={validEvents} />}

      {validEvents.map((event) => {
        const mag = parseFloat(event.mag) || 0;
        const lat = parseFloat(event.latitude);
        const lon = parseFloat(event.longitude);
        const color = magToColor(mag);
        const radius = magToRadius(mag);
        const isRecent = Date.now() - new Date(getEventTime(event)).getTime() < 3600_000;

        return (
          <CircleMarker
            key={event.id}
            center={[lat, lon]}
            radius={radius}
            pathOptions={{
              color: color,
              fillColor: color,
              fillOpacity: isRecent ? 0.7 : 0.4,
              weight: isRecent ? 2 : 1,
              opacity: isRecent ? 0.9 : 0.5,
            }}
            eventHandlers={{
              click: () => onSelectEvent?.(event),
            }}
          >
            <Popup>
              <div className="text-xs space-y-1" style={{ color: "#e2e8f0", minWidth: 160 }}>
                <div className="font-bold" style={{ color }}>M{mag.toFixed(1)}</div>
                <div>{event.place || "Unknown"}</div>
                <div className="opacity-70">Depth: {event.depth ? `${parseFloat(event.depth).toFixed(1)}km` : "—"}</div>
                <div className="opacity-70">{timeAgo(getEventTime(event))}</div>
                {event.tsunami === 1 && <div style={{ color: "#ef4444" }}>🌊 Tsunami Warning</div>}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
