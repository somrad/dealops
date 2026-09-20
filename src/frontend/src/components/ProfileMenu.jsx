import { useState } from "react";
import { FaSignOutAlt } from "react-icons/fa";
import Avatar from "./Avatar";

const ROLE_LABELS = {
  deal_team: "Deal Team",
  ops_manager: "Ops Manager",
  ops_team_member: "Ops Team",
  checker: "Checker",
};

// Extracted out of Navbar so DealRoomPage can compose it directly into its
// own merged top bar instead of the (now deal-room-hidden) global Navbar.
function ProfileMenu({ user, onLogout }) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);

  return (
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
  );
}

export default ProfileMenu;
