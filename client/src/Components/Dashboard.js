import React, { useState, useEffect, useMemo, useRef } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import { socket } from "../socket";
import "./PriorityBadges.css";
import "./Dashboard.css"; // Assuming you have some CSS for styling
import { FaQrcode, FaPencilAlt, FaTrashAlt, FaFileAlt, FaEye, FaPaperPlane } from "react-icons/fa";
import { RiHomeOfficeFill } from "react-icons/ri";
import { BsCalendarDateFill } from "react-icons/bs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import useOffices from "../utils/useOffices";
import { useAuth } from "../AuthContext";


// PdfViewer renders PDFs inside an iframe that loads an HTML wrapper page.
// IDM cannot intercept this because the iframe loads HTML, not a direct PDF URL.

function PdfViewer({ filePath, title, style }) {
  const viewerUrl = `/api/pdf-viewer?path=${encodeURIComponent(filePath)}`;
  return (
    <iframe
      src={viewerUrl}
      title={title || 'PDF'}
      style={style || { width: '100%', height: '600px', border: 'none' }}
    />
  );
}

function AutocompleteInput({
  id,
  label,
  name,
  value,
  onChange,
  options,
  required = false,
  placeholder,
}) {
  const listId = `${id || name}-list`;
  const normalizeOnBlur = () => {
    if (!value) return;
    const hit = options.find(
      (opt) => opt.toLowerCase() === value.trim().toLowerCase()
    );
    if (hit && hit !== value) onChange({ target: { name, value: hit } });
  };
  return (
    <div className="col-md-6">
      <label className="form-label">
        {label}
        {required ? " *" : ""}
      </label>
      <input
        className="form-control"
        name={name}
        list={listId}
        value={value || ""}
        onChange={onChange}
        onBlur={normalizeOnBlur}
        required={required}
        placeholder={placeholder}
        autoComplete="off"
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
      {required && (
        <div className="invalid-feedback">This field is required.</div>
      )}
    </div>
  );
}

const API_BASE =
  process.env.REACT_APP_API_BASE?.replace(/\/$/, "") || "";

const norm = (s) => String(s || "").trim().toLowerCase();

// Normalize retention values like "3 Years" or "3" into the select's values.
const normalizeRetention = (v) => {
  const s = String(v || "").trim();
  if (s.toLowerCase().includes("permanent")) return "Permanent";
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? s || "1" : String(n);
};

// Turn any stored QR path (relative or Windows absolute) into a web path.
const normalizeQrPath = (p) =>
  String(p || "")
    .split("\\")
    .join("/")
    .replace(/^[A-Za-z]:/, "")
    .replace(/^\/+/, "/");

export default function Dashboard() {
  const { offices: OFFICES } = useOffices();
  const fmtDateTime = (v) => {
    if (!v) return "—";
    const d = new Date(v);
    if (isNaN(d.getTime())) return "—";
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  };

  const [rowsRaw, setRowsRaw] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const { user } = useAuth();
  const myOffice = user?.office || '';
  // viewedRecords: object { [recordId]: [office1, office2, ...] }
  const [viewedRecords, setViewedRecords] = useState(() => {
    try { return JSON.parse(localStorage.getItem('admin_viewed_records') || '{}'); } catch { return {}; }
  });
  const [showQR, setShowQR] = useState(false);
  const [qrData, setQrData] = useState({});
  const [office, setOffice] = useState("All");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const [showModal, setShowModal] = useState(false); // State for showing the modal
  const [selectedRecord, setSelectedRecord] = useState(null); // Record selected for editing
  // Document detail view state
  const [viewRecord, setViewRecord] = useState(null);
  const [showDetail, setShowDetail] = useState(false);
  const [detailFiles, setDetailFiles] = useState([]);
  // Forwarding state
  const [forwardingId, setForwardingId] = useState(null);
  const [officeSearch, setOfficeSearch] = useState({});
  const [showSuggestions, setShowSuggestions] = useState({});
  const [selectedOffices, setSelectedOffices] = useState({});
  const [formData, setFormData] = useState({
    control_number: "",
    office_requestor: "",
    description: "",
    classification: "",
    priority: "",
    record_origin: "",
    concerned_personnel: "",
    destination_office: "",
    retention_period: "",
    remarks: "",
  });
  const CLASSIFICATION_OPTIONS = [
    "Academic",
    "Administrative",
    "Financial",
    "HR",
    "Others",
  ];
  const PRIORITY_OPTIONS = ["Normal", "Urgent", "Immediate"];
  const RETENTION_OPTIONS = [
    { label: "1 Year", value: "1" },
    { label: "2 Years", value: "2" },
    { label: "3 Years", value: "3" },
    { label: "4 Years", value: "4" },
    { label: "5 Years", value: "5" },
    { label: "6 Years", value: "6" },
    { label: "7 Years", value: "7" },
    { label: "8 Years", value: "8" },
    { label: "9 Years", value: "9" },
    { label: "10 Years", value: "10" },
    { label: "Permanent", value: "Permanent" },
  ];

  const DESTINATION_OFFICES = OFFICES;
  const CONCERNED_PERSONNEL = [
    " Elizabeth R. Oppuer",
    " Jamina G. Camayang",
    " Maria C. Hernandez",
    " Katherina C. Sarsonas",
    " Jonah C. Celestino",
    " Isabel F. Salvador",
    " Rosalyn L. Delizo",
    " Leila M. Sabbaluca",
    " Fredisminda M. Dolojan",
    " Cynthia Grace T. Valdez",
    " Jimmy S. Matias",
    " Edgar V. Benabise",
    " Mila T. Benabise",
    " George S. Lajola",
    " Julie E. Luis",
    " Agaton Jr. P. Pattalitan",
    " Jaysonn P. Villamayor",
    " Ceasar M. Bangloy",
    " Ma. Theresa B. Valerio",
    " Cherry P. Collado",
    " Rodrigo Jr. H. Castillo",
    " Nelson D. Guray",
    " Rhiza Grace A. Ramos",
    " Romeo Jr. B. Nanglihan",
    " Josefina G. Luis",
    " Lahaina Sue C. Azarcon",
    " Rey C. Naval",
    " Nida G. Quitan",
    " Ronald T. Delos Santos",
    " Arlyn J. Yra",
    " Jay-r R. Duldulao",
    " Divine Grace D. Olaño",
    " Arsenia V. Duldulao",
    " Jhanrol M. Pascual",
    " Jay Francis P. Yra",
    " Mary Ann R. Dela Cruz",
    " Eleanor G. Garingan",
    " Julius G. Gumayagay",
    " Janet D. Marcos",
    " Divina Gracia S. Sabio",
    " Elizabeth T. Carig",
    " Jenalyn M. Sarmiento",
    " Allan G. Galam",
    " Jaimark P. Villamayor",
    " Jonathan N. Tariga",
    " Elizabeth D. Antonio",
    " Ruby Lyn V. Gutierrez",
    " Romar B. Antonio",
    " Leah Grace R. Baguilat",
    " Myra T. Sagun",
    " Eddie L. Salvador",
    " Rommel G. Peralta",
    " Dyanika P. Nolasco",
    " Tessie N. Butic",
    " Remylien C. Songco",
    " Ana Maria C. Ventura",
    " Ray John M. Ramos",
    " Jennyvi G. Pascua",
    " Ma. Kristine Grace V. Ocado",
    " Florigold V. Saldaen",
    " Kristine Joy A. Castillo",
    " Velor Jay B. Olaño",
    " Mary Grace L. Sadang",
    " Romiro G. Bautista",
    " Maria Elena D. Dupa",
    " Lorelie B. Marquez",
    " Eden Maye D. Barayuga",
    " Baldomero Jr. T. Lacaden",
    " Joel G. Carig",
    " Princess Lady-Lin C. Eraña",
    " Mary Rose C. Liwag",
    " Greguel Ailan D. Barayuga",
    " Jonalyn J. Quinan",
    " Julious C. Matias",
    " Florante U. Galindo",
    " Joselle D. Concepcion",
    " Elizabeth P. Ancheta",
    " Nimpha B. Amtalao",
    " Crisanta L. Baquiran",
    " Mary Glo M. Bonilla",
    " Jefferson N. Curammeng",
    " Rosalinda N. Espaldon",
    " Melanie L. Fulgencio",
    " Nito B. Galanta",
    " Mary Joy E. Gumayagay",
    " Mishell Q. Jaramillo",
    " Cristobal B. Laslas",
    " Liezel S. Lopez",
    " Juniora Blessie Ann N. Martinez",
    " Dennis S. Opiano",
    " Amelia B. Pascua",
    " Ailyn Joy T. Padrigo",
    " Rowena Y. Pimentel",
    " France Marie Ann R. Tacadena",
    " Jesusie T. Ramones",
    " Mary Joy A. Roldan",
    " Aimee Carol R. Tangonan",
    " April Corazon G. Abon",
    " Israel M. Eraña",
    " Maricris V. Nanglihan",
    " Paul B. Pablo",
    " Minajoy B. Wigan",
    " German Jr. P. Umhaw",
    " Mariel May S. Kidkid",
    " Claudine Fay T. Domingo",
    " Nobelyn V. Agapito",
    " Danisse Mae P. Hernandez",
    " Frelita O. Bartolome",
    " Gilbren Jane G. Camayang",
    " Reymund S. Grospe",
    " Ysmael R. Draman",
    " Arnel B. Agbayani",
    " Denson M. Liday",
    " Marites M. Ancheta",
    " Avelino Jr. V. Pangilinan",
    " Samuel B. Quezon",
    " Rachel Jade C. Yere",
    " Krisma Jean L. Vargas",
    " Maria Teresa O. Bucio",
    " Darwynn B. Estillore",
    " Jaypee Angelo P. Manuel",
    " Rowena S. Cabacungan",
    " Marjorie C. Opiano",
    " Winrich John A. Vargas",
    " Richard P. Pablo",
    " Jerol C. Dupaya",
    " Marnie L. Bacdangan",
    " Junmar A. Liwan",
    " Myleene V. Bulong",
    " Jay-Ar C. Del Rosario",
    " Lourdes A. Curzon",
    " Benjamin II S. Julian",
    " Elyzar R. Rico",
    " Henrey R. Ignacio",
    " Maricel B. Barroga",
    " William Jr. L. Sabug",
    " Abigail T. Bongtayon",
    " Marvin D. Olog",
    " Marites O. Domingo",
    " Sherwin A. Eugenio",
    " Resty V. Gumuwang",
    " Robert L. Damayon",
    " Jumreih T. Cacal",
    " Mae Ann C. Gawat",
    " Girlie A. Dela Cruz",
    " Elisio A. Ocado",
    " Gideon Jyrus A. Matias",
    " Vincent Aldrin A. Yap",
    " Mary Jane T. Puon",
    " Czarina Jean S. Tolenada",
    " Krista Jessa Mae D. Loñez",
    " Devited P. Jaramillo",
    " Jay ar L. Dultiao",
    " Jesa Jane F. Sales",
    " Anjomar P. Tuazon",
    " Merlyn P. Guade",
    " Devorah Jane B. Beltran",
    " Mark O. Palaje",
    " John Paul C. Afalla",
    " John John A. Abubo",
    " Ricky G. Puon",
    " Norman Jay E. Bulong",
    " Romelyn S. Tugade",
    " Arnel D. Esquibal",
    " Marilyne C. Attaban",
    " Bladimer Ali Annuar T. Lacaden",
    " Rodolfo E. Luis",
    " Edison Kurt M. Pacunla",
    " Rommel V. Padrigo",
    " Victoria N. Vicente",
    " Edralyn A. Galamay",
    " Belmer Jr. P. Guerrero",
    " Jhon Mark S. Agsalud",
    " Geraldine T. Fernando",
    " Monica B. Naval",
    " Christian Cel W. Julian",
    " Ronald M. Buscayno",
    " Robert John C. Tobias",
    " Paul P. Macarilay",
    " Nigel Fernand T. Corpuz",
    " Primalyn G. Quimson",
    " Vanessa Jean B. Patindol",
    " Nelson B. Ohomna",
    " Edrylle Jann T. Ramos",
    " Cynthia G. Ayado",
    " Gerlyn B. Orpiano",
    " Mark Jefferson L. Mauyao",
    " Dionie M. Necor",
    " Harold N. Valentino",
    " Krestalin A. Castillo",
    " Mylavi H. Bernardino",
    " Giancarlo B. Bautista",
    " Jestonie T. De Vera",
    " Gerald M. Lamaroza",
    " Lenie C. Pascua",
    " Helen M. Villanueva",
    " Krisette Maie J. Sagales",
    " Andrei Josef C. Guiamoy",
    " Reynaldo Jr. M. Dulatre",
    " Reymos C. Mabudyang",
    " Mechil C. Domingo",
    " Alvin A. Bangloy",
    " Alphine P. Seriosa",
    " Gazelle C. Nazarro",
    " Geoff D. Monsalud",
    " Marijoy C. Awisen",
    " Shamma Mae A. Agustin",
    " Romie Jr. E. Antonio",
    " Kevin Mar T. Dela Cruz",
    " Bernard Jr. G. Baui",
    " Maribel J. Zonio",
    " Jojie Joy P. Retoria",
    " Jonathan C. Pablo",
    " Jheremy T. Escalante",
    " Ma. Anthonette S. Cabe",
    " Jezrelle Joy T. Dela Cruz",
    " Rohito P. Roga",
    " Mary Ann T. Magbanua",
    " Gremilyn D. Padrigo",
    " Evien Reinel B. Gulan",
    " Analiza  Tuppal",
    " Marrieta  Mangoba",
    " Irene M. Abenojar",
    " Maricar R. Abello",
    " Kristine Joy C. Mendoza",
    " Jomari L. Martinez",
    " Valen Jesnna L. Andres",
    " Demetrio Jr. P. Tomas",
    " Jeremy M. Abad",
    " Fergie Anne A. Cafirma",
    " Raymart M. Alvarez",
    " Ciarayna Len E. Diampoc",
    " Jomerson R. Tolentino",
    " Kristine Bernadette M. Apolonio",
    " Peter Paul D. Guray",
    " Germilyne B. Anzaldo",
    " Blessing C. Ganotice",
    " Joecelle Celeste C. Manuel",
    " Arnold N. Pugong",
    " Jonelyn L. Agmaliw",
    " Bernadette D. Asuncion",
    " Elaine May R. Gonzales",
    " Silverio Jr. D. Pascua",
    " Justin A. Padua",
    " Gideon L. Pingkihan",
    " Michael R. Magdangal",
    " Jennifer O. Dupaya",
    " Ronalyn L. Barawid",
    " Eula Jane M. Tamayo",
    " Johnalyn T. Valentino",
    " Monica D. Hernando",
    " Brandon James D. Lagmay",
    " Glomar N. Antonio Jr.",
    " Devine Grace A. Bautista",
    " Rachel M. Bangyod",
    " Reina Beth S. Sabado",
    " Cherry Ann Joy A. Lucena",
    " Reynaldo B. Darang",
    " Novembereigne D. Ugay",
    " Amelyn G. Prado",
    " Angela Mae S. Tomas",
    " Prince Jerson D. Tomas",
    " Martin Jan Levy V. Alcantara",
    " Mark M. Rambac",
    " Delfhiemae Alpha A. Lonez",
    " Glydel G. Arcangel",
    " Francis Klaus E. Imperio",
    " Mark Lester P. Padua",
    " Nolly C. Dacumos",
    " Leny Jewel G. Malaque",
    " Reymarc R. Acosta",
    " Kaye Aneth M. Bartolome",
    " Goldamae D. Estillore",
    " Blessie Loraine B. Guyo",
    " Carla Joyce I. Bartolome",
    " Andrea M. Acob",
    " Reyliza A. Ramos",
    " Jaysar R. Matias",
    " Cristeta S. Damasco",
    " Mark Jam C. Capistrano",
    " Jennifer R. Gacad",
    " Joana Rose C. Garnace",
    " Alicia Allyson Jonh U. Gaerlan",
    " Dianne Nyra C. Garcia",
    " Hannie Mae L. Pablo",
    " Joey D. Marcos",
    " Geremy C. Bayang",
    " Iriz R. Erfe",
    " Ramon Jr. D. Sanchez",
    " Sunshine Mae R. Vinluan",
    " Jojo C. Olonan",
    " Francis C. Oleta",
    " Emeterio B. Vicente",
    " Alvin Rhyan D. Fernandez",
    " Esther B. Florendo",
    " Genesis B. Punhagban",
    " Lemuel P. Rivera",
    " Dondon T. Dagdag",
    " Pacito P. Geron",
    " Reyvilen Pearl D. Esguerra",
    " Joshua L. Bucasan",
    " Renalyn S. Refugia",
    " Bernard R. Milla",
    " Mary Jane R. Trinidad",
    " Aldrin N. Damance",
    " Consuelo P. Dionio",
    " Danilo Jr. G. Galam",
    " Jami Joyce T. Carig",
    " John Eduard U. Bacani",
    " Hazel Joy A. Pascua",
    " David D. Estigoy",
    " Kristine G. Tagalisma",
    " Marjorie Anne M. Viloria",
    " Leonida L. Boquing",
    " Nimfa A. Valdez",
    " Mayjuleth  Ramos",
    " Crisologo E. Del Rosario",
    " Lauro S. Aspiras",
    " Emma D. Aspiras",
    " Richmond Bernie T. Estela",
    " Mike B. Binwag",
  ];

  const [filterType, setFilterType] = useState("All"); // Track filter state
  const [files, setFiles] = useState([]);
  const [filesError, setFilesError] = useState("");
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const mapKey = (f) => `${f.name}__${f.size}__${f.lastModified}`;
  const addFiles = (incomingList) => {
    const incoming = Array.from(incomingList || []);
    if (!incoming.length) return;
    const cur = new Map(files.map((f) => [mapKey(f), f]));
    for (const f of incoming) cur.set(mapKey(f), f);
    setFiles(Array.from(cur.values()));
    setFilesError("");
  };
  const dropStyle = {
    border: `2px dashed ${filesError ? "#dc3545" : "#999"}`,
    borderRadius: 12,
    padding: 16,
    textAlign: "center",
    cursor: "pointer",
    background: dragActive ? "rgba(0,123,255,0.08)" : "#fafafa",
    transition: "background 120ms ease",
  };
  const handleFilesChange = (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  };

  const removeFile = (idx) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const onDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };
  const onDragEnter = onDragOver;
  const onDragLeave = (e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragActive(false);
  };
  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    addFiles(e.dataTransfer.files);
  };
  const openFileDialog = () => fileInputRef.current?.click();

  // Function to load records
  const load = async () => {
    try {
      setLoading(true);
      const res = await axios.get("/records/my-office");
      setRowsRaw(Array.isArray(res.data) ? res.data : []);
      console.log("Fetched Records:", res.data); // Log fetched records
      setError(null);
    } catch (e) {
      console.error("Load records error:", e?.response?.data || e.message);
      if (e?.response?.status === 401 || e?.response?.status === 403) {
        setError("Session expired or unauthorized. Please log in again.");
      } else {
        setError("Failed to load records");
      }
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    const onUpdated = () => load();
    socket.on("recordUpdated", onUpdated);
    load(); // Fetch records initially
    return () => socket.off("recordUpdated", onUpdated);
  }, []);

  // Handle edit
  const handleEdit = (record) => {
    setSelectedRecord(record); // Store the selected record
    setFormData({
      control_number: record.control_number,
      office_requestor: record.office_requestor,
      description: record.description,
      classification: record.classification,
      priority: record.priority,
      record_origin: record.record_origin,
      concerned_personnel: record.concerned_personnel,
      destination_office: record.destination_office,
      retention_period: normalizeRetention(record.retention_period),
      current_office: record.current_office || "Unknown Office",
    });
    setShowModal(true); // Show the modal
  };

  // Handle update form field change
  const handleChange = (e) => {
    const { name, value } = e.target;

    console.log(`Updating ${name}:`, value); // Add this to track changes
    setFormData((prevState) => ({ ...prevState, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validate required fields before updating
    if (!formData.destination_office || String(formData.destination_office).trim() === '') {
      alert('Destination Office is required.');
      return;
    }
    if (!formData.concerned_personnel || String(formData.concerned_personnel).trim() === '') {
      alert('Concerned Personnel is required.');
      return;
    }

    // Creating FormData instance
    const formDataToSend = new FormData();

    // Append the fields that are being updated
    formDataToSend.append("concerned_personnel", formData.concerned_personnel);
    formDataToSend.append("destination_office", formData.destination_office);
    formDataToSend.append("retention_period", formData.retention_period);
    formDataToSend.append("remarks", formData.remarks || "No remarks");
    formDataToSend.append(
      "current_office",
      formData.current_office || "Unknown Office"
    );
    // Append the files to FormData if there are any
    files.forEach((file) => {
      formDataToSend.append("files", file);
    });

    // Log the FormData object to check if data is appended correctly
    console.log("FormData to Send:", formDataToSend);

    try {
      // Sending the PUT request to the backend
      await axios.put(`/records/${selectedRecord.id}`, formDataToSend, {
        headers: {
          "Content-Type": "multipart/form-data", // Ensure content type is multipart/form-data
        },
      });

      alert("Record updated successfully!");
      setShowModal(false);
      load(); // Reload the records to reflect the updated data
    } catch (e) {
      console.error(
        "Error response from backend:",
        e.response?.data || e.message
      );
      alert(
        "Failed to update record: " + (e.response?.data?.message || e.message)
      );
    }
  };

  // Handle delete
  const handleDelete = async (r) => {
    if (!r.id) return alert("Cannot delete this record.");
    if (!window.confirm(`Delete "${r.control_number}"? This cannot be undone.`))
      return;
    try {
      setDeletingId(r.id);
      await axios.delete(`/records/${r.id}`);
      setRowsRaw((prev) => prev.filter((x) => x.id !== r.id));
    } catch (e) {
      console.error(e);
      alert("Failed to delete record.");
    } finally {
      setDeletingId(null);
    }
  };

 const records = useMemo(() => {
    const map = new Map();
    for (const [i, r] of rowsRaw.entries()) {
      const recId = r.id ?? r.control_number ?? `row-${i}`;
      if (!map.has(recId)) {
        map.set(recId, {
          id: recId,
          control_number: r.control_number || "",
          classification: r.classification || "",
          priority: r.priority || "Normal",
          office_requestor: r.office_requestor || "",
          destination_office: r.destination_office || "",
          record_origin: r.record_origin || "Unknown",
          created_at: r.created_at || null,
          updated_at: r.updated_at || r.created_at, // Keep track of both
          description: r.description || "",
          retention_period: r.retention_period || "",
          remarks: r.remarks || "",
          status: r.qrcode_path ? "Updated" : "Not Updated", // Check if QR code exists
          forwarded_at: r.forwarded_at || null,
          received_at: r.received_at || null,
          files: [],
          qrcode_path: r.qrcode_path || "",
          current_office: r.current_office || "Unknown Office",
        });
      }
      if (r.file_path) {
        map.get(recId).files.push({
          name: r.file_name || r.file_path.split("/").pop(),
          path: r.file_path,
        });
      }
    }
    return Array.from(map.values()).sort(
      (a, b) =>
        (new Date(b.created_at).getTime() || 0) -
        (new Date(a.created_at).getTime() || 0)
    );
  }, [rowsRaw]);

  const filtered = useMemo(() => {
    const fromT = fromDate ? new Date(fromDate).setHours(0, 0, 0, 0) : null;
    const toT = toDate ? new Date(toDate).setHours(23, 59, 59, 999) : null;

    return records.filter((r) => {
      // Filter by office: documents currently at, destined for, or requested by this office
      if (office !== "All") {
        const o = office.trim().toLowerCase();
        const dest = String(r.destination_office || "").trim().toLowerCase();
        const cur = String(r.current_office || "").trim().toLowerCase();
        const req = String(r.office_requestor || "").trim().toLowerCase();
        if (dest !== o && cur !== o && req !== o) return false;
      }

      // Filter by date range (from - to, inclusive)
      const ct = r.created_at ? new Date(r.created_at).getTime() : null;
      if (ct != null && fromT && ct < fromT) return false;
      if (ct != null && toT && ct > toT) return false;

      // Filter by internal or external records
      if (
        filterType !== "All" &&
        !String(r.record_origin || "")
          .toLowerCase()
          .includes(filterType.toLowerCase())
      )
        return false;

      // Filter by update status (Updated = has QR code)
      if (statusFilter !== "All" && r.status !== statusFilter) return false;

      return true;
    });
  }, [records, office, fromDate, toDate, filterType, statusFilter]);

  const officeCount = useMemo(() => {
    const counts = {};
    // Count ALL records (not just filtered) for accurate Office Records Overview
    records.forEach((record) => {
      const off = record.current_office || record.destination_office || "Unknown Office";
      counts[off] = (counts[off] || 0) + 1;
    });
    return counts;
  }, [records]);
  const handleViewQR = (r) => {
    if (!r.qrcode_path) return alert("QR code not available for this record.");

    setQrData({
      control_number: r.control_number,
      title: r.title || r.description,
      url: normalizeQrPath(r.qrcode_path),
    });
    setShowQR(true);
  };

  // Open document detail view showing PDF + routing slip
  const handleViewDocument = async (r) => {
    setViewRecord(r);
    setDetailFiles(r.files || []);
    setShowDetail(true);
    // Mark record as viewed in THIS office only — per-office NEW badge
    const viewedByOffices = viewedRecords[r.id] || [];
    if (!viewedByOffices.includes(myOffice)) {
      const updated = { ...viewedRecords, [r.id]: [...viewedByOffices, myOffice] };
      setViewedRecords(updated);
      localStorage.setItem('admin_viewed_records', JSON.stringify(updated));
    }
    // Enrich with full file data from server
    try {
      const res = await axios.get(`/records/${r.id}`);
      const data = res.data;
      if (data.files && data.files.length > 0) {
        setDetailFiles(data.files);
      }
    } catch (e) {
      console.error("Error loading record details:", e);
    }

  };

  // -------------------- Multi-Office Forward (Admin) --------------------
  const addOffice = (recordId, office) => {
    setSelectedOffices((prev) => {
      const current = prev[recordId] || [];
      if (current.includes(office)) return prev;
      return { ...prev, [recordId]: [...current, office] };
    });
    setOfficeSearch((prev) => ({ ...prev, [recordId]: "" }));
    setShowSuggestions((prev) => ({ ...prev, [recordId]: false }));
  };

  const removeOffice = (recordId, office) => {
    setSelectedOffices((prev) => ({
      ...prev,
      [recordId]: (prev[recordId] || []).filter((o) => o !== office),
    }));
  };

  const getFilteredSuggestions = (recordId) => {
    const query = (officeSearch[recordId] || "").toLowerCase();
    const selected = selectedOffices[recordId] || [];
    return OFFICES.filter(
      (o) =>
        o.toLowerCase().includes(query) &&
        !selected.includes(o) &&
        query.length > 0
    );
  };

  const handleForward = async (record) => {
    const selected = selectedOffices[record.id] || [];
    if (selected.length === 0)
      return alert("Please select at least one destination office.");
    if (
      !window.confirm(
        `Forward "${record.control_number}" to ${selected.join(", ")}?`
      )
    )
      return;

    setForwardingId(record.id);
    try {
      await axios.put(`/records/forward/${record.id}`, {
        destination_offices: selected,
      });
      alert(`Record forwarded to ${selected.join(", ")}.`);
      setSelectedOffices((prev) => ({ ...prev, [record.id]: [] }));
      load();
    } catch (err) {
      const msg = err?.response?.data?.error || "Failed to forward record.";
      console.error("Forward error:", err);
      alert(msg);
    } finally {
      setForwardingId(null);
    }
  };

  const chartData = useMemo(() => {
    return Object.keys(officeCount).map((office) => ({
      office: office,
      records: officeCount[office],
    }));
  }, [officeCount]);
  const closeModal = () => {
    setShowQR(false); // Hide the modal when closing it
  };
  const [currentPage, setCurrentPage] = useState(1);
  // const itemsPerPage = 9999; // Set the number of items per page

  const cardContainerRef = useRef(null);
  const cardRef = useRef(null);

  // 💡 FIX 1: Initialized itemsPerPage to a safe default (or 1)
  const [itemsPerPage, setItemsPerPage] = useState(12); // Start with a safe number

  // Calculate how many cards fit on screen (recomputed when data or layout changes)
  useEffect(() => {
    const calculateItemsPerPage = () => {
      if (!cardContainerRef.current || !cardRef.current || filtered.length === 0) {
        return;
      }

      const containerHeight = window.innerHeight;
      const navbarHeight = 60;
      const headerHeight = cardContainerRef.current.offsetTop;
      const availableHeight = containerHeight - headerHeight - navbarHeight - 70;

      const cardStyle = window.getComputedStyle(cardRef.current);
      const cardHeight =
        cardRef.current.offsetHeight +
        parseFloat(cardStyle.marginTop) +
        parseFloat(cardStyle.marginBottom);
      const rowsFit = Math.floor(availableHeight / cardHeight);

      const contentWidth = cardContainerRef.current.offsetWidth;
      const cardMinWidth = 150;
      const cardGap = 15;
      const colsFit = Math.floor(contentWidth / (cardMinWidth + cardGap));

      const calculatedItems = rowsFit * colsFit;

      if (calculatedItems > 0 && calculatedItems !== itemsPerPage) {
        setItemsPerPage(calculatedItems);
        setCurrentPage(1);
      }
    };

    calculateItemsPerPage();
    window.addEventListener("resize", calculateItemsPerPage);
    return () => window.removeEventListener("resize", calculateItemsPerPage);
  }, [filtered, itemsPerPage]);

  const paginatedRecords = useMemo(() => {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return filtered.slice(startIndex, endIndex);
  }, [filtered, currentPage, itemsPerPage]);

  // Helper: is this document new in the current office (forwarded within the last 24 hours)?
  const isNew = (r) => {
    if (!r.forwarded_at) return false;
    const viewedByOffices = viewedRecords[r.id] || [];
    if (viewedByOffices.includes(myOffice)) return false; // Already viewed in this office
    const diff = Date.now() - new Date(r.forwarded_at).getTime();
    return diff < 24 * 60 * 60 * 1000; // 24 hours
  };

  return (
    <div className="d-flex main-layout">
      <Sidebar />
      <div className="content-wrapper">
        <Navbar />
        <div className="container-fluid">
          <div className="dashboard-grid">
{/* FILTER */}
          <div className="filter-container">
            <div className="d-flex align-items-center filter-item">
              <label htmlFor="recordFilter" className="form-label filter-icon-label">
                <FaFileAlt className="filter-icon" />
              </label>
              <select
                id="recordFilter"
                className="form-select"
                value={filterType}
                onChange={(e) => setFilterType(e.target.value)}
              >
                <option value="All">All</option>
                <option value="internal">Internal</option>
                <option value="external">External</option>
              </select>
            </div>

            <div className="d-flex align-items-center">
              <label htmlFor="officeFilter" className="form-label filter-icon-label">
               <RiHomeOfficeFill className="filter-icon" />
              </label>
              <select
                id="officeFilter"
                className="form-select"
                value={office}
                onChange={(e) => setOffice(e.target.value)}
              >
                <option value="All">All Offices</option>
                {DESTINATION_OFFICES.map((office, index) => (
                  <option key={index} value={office}>
                    {office}
                  </option>
                ))}
              </select>
            </div>

            <div className="d-flex align-items-center filter-item">
              <label htmlFor="statusFilter" className="form-label filter-icon-label">
                <FaQrcode className="filter-icon" />
              </label>
              <select
                id="statusFilter"
                className="form-select"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="All">All Status</option>
                <option value="Updated">Updated</option>
                <option value="Not Updated">Not Updated</option>
              </select>
            </div>

            <div className="d-flex align-items-center">
              <label htmlFor="dateFilter" className="form-label filter-icon-label">
                <BsCalendarDateFill className="filter-icon" />
              </label>
              <input
                type="date"
                id="dateFilter"
                className="form-control"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
              <span className="mx-1 text-muted small">to</span>
              <input
                type="date"
                id="toDateFilter"
                className="form-control"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="showing">
            <div className="text-muted small">
              Showing <strong>{filtered.length}</strong> of {rowsRaw.length}
            </div>
          </div>
          </div>


          {/* Records Overview Chart */}
          <div className="chart-container">
            <h5 className="mb-4">Office Records Overview</h5>

            {/* Bar Chart for Records Per Office */}
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="office" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="records" fill="#35804eff" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          </div>
          
          
          

          {error && <div className="alert alert-danger">{error}</div>}
          {loading && <div className="status">Loading…</div>}

          <div className="record-cards">
            {paginatedRecords.length > 0 ? (
              paginatedRecords.map((record) => (
                <div key={record.id} className={`card record-card ${isNew(record) ? 'record-card-new' : ''}`}>
                  <div className="card-header">
                    <p>{record.control_number || "No Control Number"}</p>
                    <p>{record.record_origin || "Untitled"}</p>
                    <div className="d-flex gap-1 align-items-center">
                      {isNew(record) && (
                        <span className="badge badge-new">NEW</span>
                      )}
                      {/* Display status */}
                      <span
                        className={`badge ${
                          record.status === "Updated"
                            ? "badge-success"
                            : "badge-warning"
                        }`}
                      >
                        {record.status}
                      </span>
                      {/* Pending with President badge */}
                      {(() => {
                        const sentToPresident = String(record.destination_office || '').toLowerCase().includes('president');
                        const inRecords = String(record.current_office || '').toLowerCase().includes('records');
                        if (sentToPresident && inRecords) {
                          return <span className="badge" style={{ background: '#17a2b8', color: '#fff', marginLeft: '4px' }}>✅ Returned from President</span>;
                        } else if (sentToPresident && !inRecords) {
                          return <span className="badge" style={{ background: '#6c757d', color: '#fff', marginLeft: '4px' }}>⏳ Pending with President</span>;
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                  <div className="card-body">
                    <p>
                      <strong>Office Requestor:</strong> {record.office_requestor || "—"}
                    </p>
                    <p>
                      <strong>Classification:</strong> {record.classification}
                    </p>
                    <p>
                      <strong>Priority:</strong> {record.priority}
                    </p>
                    <p>
                      <strong>Date Created:</strong>{" "}
                      {fmtDateTime(record.created_at)}
                    </p>
                    <p>
                      <strong>Current Office:</strong>{" "}
                      {record.current_office || "Unknown Office"}
                    </p>
                    {record.received_at && (
                      <p>
                        <strong>Received:</strong>{" "}
                        {fmtDateTime(record.received_at)}
                      </p>
                    )}
                  </div>
                  <div className="card-footer">
                    <button
                      className="btn btn-outline-info"
                      title="View Document"
                      onClick={() => handleViewDocument(record)}
                    >
                      <FaEye />
                    </button>
                    <button
                      className="btn btn-outline-primary"
                      onClick={() => handleViewQR(record)}
                    >
                      <FaQrcode />
                    </button>
                    <button
                      className="btn btn-outline-success"
                      onClick={() => handleEdit(record)}
                      title={record.current_office !== "Records Management Unit" ? "Cannot edit: document is not in your office" : "Edit Record"}
                      disabled={
                        norm(record.current_office) !== norm("Records Management Unit") &&
                        norm(record.current_office) !== "unknown office"
                      }
                    >
                      <FaPencilAlt />
                    </button>
                    <button
                      className="btn btn-outline-danger"
                      disabled={deletingId === record.id}
                      onClick={() => handleDelete(record)}
                    >
                     <FaTrashAlt />
                    </button>
                  </div>

                  {/* Forward section — type-ahead office selector */}
                  <div style={{ padding: '8px 12px', borderTop: '1px solid #e9ecef', background: '#f8f9fa' }}>
                    <div className="d-flex flex-wrap gap-1 mb-1">
                      {(selectedOffices[record.id] || []).map((off) => (
                        <span key={off} className="badge bg-success d-flex align-items-center gap-1" style={{ fontSize: '0.78rem' }}>
                          {off}
                          <button type="button" className="btn-close btn-close-white" style={{ fontSize: '0.55rem' }} onClick={() => removeOffice(record.id, off)} />
                        </span>
                      ))}
                    </div>
                    <div style={{ position: 'relative' }}>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="Type to search office..."
                        value={officeSearch[record.id] || ''}
                        onChange={(e) => {
                          setOfficeSearch((prev) => ({ ...prev, [record.id]: e.target.value }));
                          setShowSuggestions((prev) => ({ ...prev, [record.id]: true }));
                        }}
                        onFocus={() => setShowSuggestions((prev) => ({ ...prev, [record.id]: true }))}
                        onBlur={() => setTimeout(() => setShowSuggestions((prev) => ({ ...prev, [record.id]: false })), 200)}
                      />
                      {showSuggestions[record.id] && getFilteredSuggestions(record.id).length > 0 && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#fff', border: '1px solid #ddd', borderRadius: '4px', maxHeight: '120px', overflowY: 'auto' }}>
                          {getFilteredSuggestions(record.id).map((off) => (
                            <div
                              key={off}
                              style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '0.8rem' }}
                              onMouseDown={() => addOffice(record.id, off)}
                            >
                              {off}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <button
                      className="btn btn-sm btn-primary mt-1 w-100"
                      disabled={(selectedOffices[record.id] || []).length === 0 || forwardingId === record.id}
                      onClick={() => handleForward(record)}
                    >
                      <FaPaperPlane className="me-1" />
                      {forwardingId === record.id ? 'Forwarding...' : `Forward to ${(selectedOffices[record.id] || []).length} Office(s)`}
                    </button>
                  </div>
                </div>
              ))
            ) : (
              <div className="status">No records available.</div>
            )}
          </div>
          
          <div className="pagination">
            <button
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
            >
              {"<<"} Previous
            </button>

            {/* Display Page Numbers */}
            {Array.from(
              { length: Math.ceil(filtered.length / itemsPerPage) },
              (_, index) => (
                <button
                  key={index + 1}
                  onClick={() => setCurrentPage(index + 1)}
                  className={currentPage === index + 1 ? "active" : ""}
                >
                  {index + 1}
                </button>
              )
            )}

            <button
              onClick={() =>
                setCurrentPage((prev) =>
                  Math.min(prev + 1, Math.ceil(filtered.length / itemsPerPage))
                )
              }
              disabled={
                currentPage === Math.ceil(filtered.length / itemsPerPage)
              }
            >
              Next {">>"}
            </button>
          </div>

          {showQR && (
            <div className="qr-modal-backdrop" onClick={closeModal}>
              <div
                className="qr-modal-dialog"
                onClick={(e) => e.stopPropagation()}
              >
                <h5>QR Code for {qrData.control_number}</h5>
                {/* Ensure the correct URL is used to display the image */}
                <img
                  src={`${API_BASE}${qrData.url}`}
                  alt={`QR Code for ${qrData.control_number}`}
                />

                <button
                  className="btn btn-sm btn-outline-secondary mt-2"
                  onClick={closeModal} // Close the modal
                >
                  Close
                </button>
              </div>
            </div>
          )}
          {/* Edit Modal */}

          {showModal && selectedRecord && (
            <div className="modal-overlay" onClick={() => setShowModal(false)}>
              {/* Modal Dialog: Prevent backdrop click when interacting with the form */}
              <div
                className="modal-content"
                onClick={(e) => e.stopPropagation()} // Prevents closing modal when clicking inside
              >
                <h2>Edit Record</h2>
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label>Control Number</label>
                    <input
                      type="text"
                      className="form-control"
                      value={formData.control_number}
                      disabled
                    />
                  </div>

                  <div className="form-group">
                    <label>Office/Requestor</label>
                    <input
                      type="text"
                      className="form-control"
                      name="office_requestor"
                      value={formData.office_requestor}
                      onChange={handleChange}
                      // required
                      disabled
                    />
                  </div>

                  <div className="form-group">
                    <label>Classification</label>
                    <select
                      className="form-control"
                      name="classification"
                      value={formData.classification}
                      onChange={handleChange}
                      // required
                      disabled
                    >
                      {CLASSIFICATION_OPTIONS.map((option, index) => (
                        <option key={index} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Priority</label>
                    <select
                      className="form-control"
                      name="priority"
                      value={formData.priority}
                      onChange={handleChange}
                      // required
                      disabled
                    >
                      {PRIORITY_OPTIONS.map((option, index) => (
                        <option key={index} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <AutocompleteInput
                      label="Concerned Personnel"
                      name="concerned_personnel"
                      value={formData.concerned_personnel}
                      onChange={handleChange}
                      options={CONCERNED_PERSONNEL}
                      placeholder="Select Concerned Personnel"
                    />
                  </div>
                  <div className="form-group">
                    <label>Destination Office</label>
                    <select
                      className="form-control"
                      name="destination_office"
                      value={formData.destination_office}
                      onChange={handleChange}
                      required
                    >
                      {DESTINATION_OFFICES.map((option, index) => (
                        <option key={index} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Retention Period</label>
                    <select
                      className="form-control"
                      name="retention_period"
                      value={formData.retention_period || "1"} // Ensure this is always a valid value
                      onChange={handleChange}
                      required
                    >
                      {RETENTION_OPTIONS.map((option, index) => (
                        <option key={index} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Description</label>
                    <textarea
                      className="form-control"
                      name="description"
                      value={formData.description}
                      onChange={handleChange}
                      // required
                      disabled
                    />
                  </div>

                  <div className="form-group">
                    <label>Remarks</label>
                    <textarea
                      className="form-control"
                      name="remarks"
                      value={formData.remarks}
                      onChange={handleChange} // Handles updating form data
                      rows={4} // Set number of rows for the textarea
                      placeholder="Add remarks here..."
                    />
                  </div>
                  {/* Attachments */}
                  <div className="col-12">
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      className="d-none"
                      onChange={handleFilesChange}
                      accept="application/pdf"
                    />
                    <div
                      style={dropStyle}
                      onClick={openFileDialog}
                      onDragOver={onDragOver}
                      onDragEnter={onDragEnter}
                      onDragLeave={onDragLeave}
                      onDrop={onDrop}
                    >
                      <div className="mb-1 fw-semibold">
                        Drag & drop files here or click to browse
                      </div>
                      <div className="text-muted small">
                        At least one PDF file required
                      </div>
                    </div>
                    {filesError && (
                      <div className="invalid-feedback d-block">
                        {filesError}
                      </div>
                    )}
                    {files.length > 0 && (
                      <ul className="list-unstyled mt-2">
                        {files.map((f, idx) => (
                          <li
                            key={mapKey(f)}
                            className="d-flex justify-content-between align-items-center"
                          >
                            <span>
                              {f.name} ({Math.round(f.size / 1024)} KB)
                            </span>
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-danger"
                              onClick={() => removeFile(idx)}
                            >
                              Remove
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <br />
                  <button
                    type="submit"
                    className="btn btn-primary"
                    onClick={(e) => e.stopPropagation()} // Prevent closing modal on form submit
                  >
                    Update Record
                  </button>

                  <button
                    className="btn btn-secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowModal(false); // Close modal when close button is clicked
                    }}
                  >
                    Close
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Document Detail Modal — PDF + Routing Slip */}
          {showDetail && viewRecord && (
            <div className="modal-overlay" onClick={() => setShowDetail(false)}>
              <div
                className="modal-content document-detail-modal"
                onClick={(e) => e.stopPropagation()}
                style={{ maxWidth: '1100px', width: '95%', maxHeight: '90vh' }}
              >
                <div className="d-flex justify-content-between align-items-center mb-3">
                  <h5 className="mb-0">
                    <FaFileAlt /> {viewRecord.control_number || "Document"}
                  </h5>
                  <div className="d-flex gap-2 align-items-center">
                    <span className={`badge ${viewRecord.status === 'Updated' ? 'badge-success' : 'badge-warning'}`}>
                      {viewRecord.status === 'Updated' ? '✅ Updated' : '⚠️ Not Updated'}
                    </span>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowDetail(false)}>✕ Close</button>
                  </div>
                </div>

                <div className="document-detail-info mb-3" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '0.88rem', background: '#f8f9fa', padding: '12px', borderRadius: '8px' }}>
                  <div>
                    <strong>Classification:</strong> {viewRecord.classification || "—"}
                  </div>
                  <div>
                    <strong>Priority:</strong> {viewRecord.priority || "Normal"}
                  </div>
                  <div>
                    <strong>Office Requestor:</strong> {viewRecord.office_requestor || "—"}
                  </div>
                  <div>
                    <strong>Destination Office:</strong> {viewRecord.destination_office || "—"}
                  </div>
                  <div>
                    <strong>Current Office:</strong> {viewRecord.current_office || "—"}
                  </div>
                  <div>
                    <strong>Record Origin:</strong> {viewRecord.record_origin || "Internal"}
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxHeight: '70vh', overflow: 'auto' }}>
                  {(() => {
                    // If a merged PDF or routing slip file exists, it means the President has processed it
                    // The routing slip is only created when the President forwards the document back
                    const mergedFile = detailFiles.find(f => String(f.name || '').toLowerCase().includes('merged'));
                    const slipFile = detailFiles.find(f => String(f.name || '').toLowerCase().includes('routing') && String(f.name || '').toLowerCase().endsWith('.pdf'));
                    const showRoutingSlip = mergedFile || slipFile;

                    // PRIORITY 1: If a merged PDF exists, show ONLY the merged file
                    if (mergedFile && showRoutingSlip) {
                      return (
                        <div style={{ background: '#e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                          <div style={{ padding: '8px 12px', background: '#dee2e6', fontWeight: 600, fontSize: '0.85rem' }}>
                            📋📄 Routing Slip + Document (Combined PDF)
                          </div>
                          <PdfViewer
                            filePath={mergedFile.path}
                            title="Merged Document"
                            style={{ width: '100%', height: '600px', border: 'none' }}
                          />
                        </div>
                      );
                    }

                    // PRIORITY 2: Show routing slip separately if no merged file exists
                    if (slipFile && showRoutingSlip) {
                      return (
                        <div style={{ background: '#e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                          <div style={{ padding: '8px 12px', background: '#dee2e6', fontWeight: 600, fontSize: '0.85rem' }}>
                            📋 Routing Slip
                          </div>
                          <PdfViewer
                            filePath={slipFile.path}
                            title="Routing Slip"
                            style={{ width: '100%', height: '500px', border: 'none' }}
                          />
                        </div>
                      );
                    }

                    // PRIORITY 3: Show document files (no routing slip or merged file, or routing slip hidden)
                    const docFiles = detailFiles.filter(f => !String(f.name || '').toLowerCase().includes('routing') && !String(f.name || '').toLowerCase().includes('merged'));
                    if (docFiles.length === 0) {
                      return (
                        <div style={{ background: '#e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                          <div style={{ padding: '8px 12px', background: '#dee2e6', fontWeight: 600, fontSize: '0.85rem' }}>
                            📄 Document PDF
                          </div>
                          <div style={{ padding: '40px', textAlign: 'center', color: '#6c757d' }}>No document files</div>
                        </div>
                      );
                    }
                    return (
                      <div style={{ background: '#e9ecef', borderRadius: '8px', overflow: 'hidden' }}>
                        <div style={{ padding: '8px 12px', background: '#dee2e6', fontWeight: 600, fontSize: '0.85rem' }}>
                          📄 Document PDF
                        </div>
                        <div>
                          {docFiles.map((file, idx) => {
                            const filePath = file.path || '';
                            const fileName = file.name || '';
                            const isPdf = String(fileName).toLowerCase().endsWith('.pdf');
                            if (isPdf) {
                              return (
                                <PdfViewer
                                  key={idx}
                                  filePath={filePath}
                                  title={fileName}
                                  style={{ width: '100%', height: '500px', border: 'none' }}
                                />
                              );
                            }
                            return (
                              <div key={idx} style={{ padding: '16px' }}>
                                <a href={filePath.startsWith('/') ? filePath : '/' + filePath} target="_blank" rel="noopener noreferrer">
                                  📎 {fileName}
                                </a>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
