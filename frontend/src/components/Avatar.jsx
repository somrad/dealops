import { FaRobot } from "react-icons/fa";

const COLORS = ["#2563eb", "#7c3aed", "#db2777", "#059669", "#d97706", "#0891b2"];

function colorForName(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return COLORS[Math.abs(hash) % COLORS.length];
}

function initials(name) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Avatar({ name, size = 36, role }) {
  const isAgent = role === "agent";

  const style = {
    width: size,
    height: size,
    borderRadius: "50%",
    background: isAgent ? "#4b5563" : colorForName(name),
    color: "white",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontWeight: 600,
    fontSize: size * 0.4,
    flexShrink: 0,
  };

  if (isAgent) {
    return (
      <div style={style} title={name}>
        <FaRobot size={size * 0.55} />
      </div>
    );
  }

  return (
    <div style={style} title={name}>
      {initials(name)}
    </div>
  );
}

export default Avatar;
