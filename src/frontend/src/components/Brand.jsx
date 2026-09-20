import { FaHandshake } from "react-icons/fa";
import { useNavigate } from "react-router-dom";

// Shared between Navbar (dashboard) and DealRoomPage's own merged top bar —
// same click-to-home brand mark either place it lives.
function Brand() {
  const navigate = useNavigate();
  return (
    <div className="navbar-brand" onClick={() => navigate("/deals")}>
      <FaHandshake className="navbar-logo" />
      <span>dealops</span>
    </div>
  );
}

export default Brand;
