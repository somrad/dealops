import { useState } from "react";
import { FaHandshake, FaSignOutAlt } from "react-icons/fa";
import { useNavigate } from "react-router-dom";
import Avatar from "./Avatar";

const ROLE_LABELS = {
  deal_team: "Deal Team",
  ops_manager: "Ops Manager",
  ops_team_member: "Ops Team",
  checker: "Checker",
};

function Navbar({ user, onLogout }) {
  const navigate = useNavigate();
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  return (
    <header className="navbar">
      <div className="navbar-brand" onClick={() => navigate("/deals")}>
        <FaHandshake className="navbar-logo" />
        <span>dealops</span>
      </div>

      <div className="profile-menu-wrapper">
        <button
          className="profile-trigger"
          onClick={() => setShowProfileMenu((v) => !v)}
          onBlur={() => setTimeout(() => setShowProfileMenu(false), 150)}
          title={user.name}
        >
          <Avatar name={user.name} size={32} />
        </button>
        {showProfileMenu && (
          <div className="profile-menu">
            <div className="profile-menu-header">
              <strong>{user.name}</strong>
              <span className="role-badge">{ROLE_LABELS[user.role] || user.role}</span>
            </div>
            <button type="button" className="profile-menu-item" onMouseDown={onLogout}>
              <FaSignOutAlt /> Log out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

export default Navbar;
