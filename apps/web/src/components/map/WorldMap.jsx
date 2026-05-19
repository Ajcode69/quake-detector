import { MapContainer, TileLayer, CircleMarker, Marker, Popup, useMap } from "react-leaflet";
import L from "leaflet";
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
  const validEvents = events.filter((e) => (e.latitude || e.lat) && (e.longitude || e.lng));

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
        const lat = parseFloat(event.latitude || event.lat);
        const lon = parseFloat(event.longitude || event.lng);
        const mag = parseFloat(event.maxMag || event.mag) || 0;
        
        if (event.type === 'cluster') {
          const count = event.count || 1;
          const size = Math.min(80, 30 + Math.log10(count) * 10);
          const icon = L.divIcon({
            html: `<div style="background-color: rgba(59, 130, 246, 0.6); color: white; border-radius: 50%; width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 11px; border: 2px solid rgba(255,255,255,0.3); box-shadow: 0 0 10px rgba(0,0,0,0.5);">${count > 999 ? '999+' : count}</div>`,
            className: 'custom-cluster-icon',
            iconSize: [size, size],
            iconAnchor: [size/2, size/2],
          });
          return (
            <Marker key={event.id} position={[lat, lon]} icon={icon}>
              <Popup>
                <div className="text-xs space-y-1" style={{ color: "#e2e8f0", minWidth: 140 }}>
                  <div className="font-bold text-blue-400">Cluster of {count} Events</div>
                  <div>Max Magnitude: <span className="font-bold text-amber-400">M{mag.toFixed(1)}</span></div>
                </div>
              </Popup>
            </Marker>
          );
        }

        const color = magToColor(mag);
        const radius = magToRadius(mag);
        const eventTime = getEventTime(event) || event.eventTime;
        const isRecent = eventTime ? (Date.now() - new Date(eventTime).getTime() < 3600_000) : false;
        
        const isBlinking = event.eventClass === "tsunami_risk" || event.eventClass === "major_quake" || event.alert === 'red' || mag >= 6.0;

        return (
          <CircleMarker
            key={event.id}
            center={[lat, lon]}
            radius={radius}
            pathOptions={{
              color: isBlinking ? '#ef4444' : color,
              fillColor: isBlinking ? '#ef4444' : color,
              fillOpacity: isRecent ? 0.7 : 0.4,
              weight: isRecent ? 2 : 1,
              opacity: isRecent ? 0.9 : 0.5,
              className: isBlinking ? 'svg-pulse' : ''
            }}
            eventHandlers={{
              click: () => onSelectEvent?.(event),
            }}
          >
            <Popup>
              <div className="text-xs space-y-1" style={{ color: "#e2e8f0", minWidth: 160 }}>
                <div className="font-bold" style={{ color }}>M{mag.toFixed(1)}</div>
                <div>{event.place || "Unknown Location"}</div>
                <div className="opacity-70">Depth: {event.depth ? `${parseFloat(event.depth).toFixed(1)}km` : "—"}</div>
                {event.impactScore != null && (
                  <div className="opacity-90 mt-1">Impact: <span className="font-bold">{event.impactScore}</span></div>
                )}
                {event.confidenceScore != null && (
                  <div className="opacity-90">Confidence: <span className="font-bold">{event.confidenceScore}%</span></div>
                )}
                {event.eventClass && (
                  <div className="opacity-90 capitalize text-amber-400">
                    {event.eventClass.replace("_", " ")}
                  </div>
                )}
                {eventTime && <div className="opacity-70 mt-1">{timeAgo(eventTime)}</div>}
                {event.tsunami === 1 && <div style={{ color: "#ef4444" }}>🌊 Tsunami Warning</div>}
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
