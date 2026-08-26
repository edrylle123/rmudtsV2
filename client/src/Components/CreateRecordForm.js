import React, { useState, useRef, useEffect } from "react";
import "./CreateRecordForm.css";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import axios from "./axios";
import useOffices from "../utils/useOffices";
import "bootstrap/dist/css/bootstrap.min.css";

const CLASSIFICATION_OPTIONS = [
  "Academic",
  "Administrative",
  "Financial",
  "HR",
  "Others",
];
const PRIORITY_OPTIONS = ["Normal", "Urgent", "Immediate"];
const ORIGIN_OPTIONS = ["Internal", "External"]; // Document type options

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

// Reusable autocomplete input
function AutocompleteInput({
  id,
  label,
  name,
  value,
  onChange,
  options,
  required = true,
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
        autoComplete={name}
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

export default function CreateRecordForm() {
  const { offices: DESTINATION_OFFICES } = useOffices();
  const [controlNumber, setControlNumber] = useState("");

  const [formData, setFormData] = useState({
    office_requestor: "",
    classification: "",
    priority: "",
    description: "",
    current_office: "",
    concerned_personnel: "",
    destination_office: "",
    retention_period: "",
    control_number: "",
    record_origin: "",
  });
  const [activeOrigin, setActiveOrigin] = useState("");
  const [files, setFiles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [validated, setValidated] = useState(false);
  const [filesError, setFilesError] = useState("");
  const formRef = useRef(null);
  const fileInputRef = useRef(null);
  const [dragActive, setDragActive] = useState(false);
  const [formKey, setFormKey] = useState(0); // Add a key to force re-render
  const [isResetting, setIsResetting] = useState(false);

  // ---- handlers
  const handleOriginSwitch = (origin) => {
    setActiveOrigin(origin);
    setFormData((s) => ({ ...s, record_origin: origin })); // This updates the formData with the correct origin
  };

  // const handleChange = (e) => {
  //   const { name, value } = e.target;
  //   setFormData((s) => ({ ...s, [name]: value }));
  // };
const handleChange = (e) => {
  const { name, value } = e.target;
  setFormData(prev => ({ ...prev, [name]: value }));
};
  const mapKey = (f) => `${f.name}__${f.size}__${f.lastModified}`;
  const addFiles = (incomingList) => {
    const incoming = Array.from(incomingList || []);
    if (!incoming.length) return;
    const cur = new Map(files.map((f) => [mapKey(f), f]));
    for (const f of incoming) cur.set(mapKey(f), f);
    setFiles(Array.from(cur.values()));
    setFilesError("");
  };

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

  const handleFilesChange = (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  };

  const removeFile = (idx) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  const dropStyle = {
    border: `2px dashed ${filesError ? "#dc3545" : "#999"}`,
    borderRadius: 12,
    padding: 16,
    textAlign: "center",
    cursor: "pointer",
    background: dragActive ? "rgba(0,123,255,0.08)" : "#fafafa",
    transition: "background 120ms ease",
  };

  // Validate PDF files before submitting
  const validateFiles = () => {
    for (const file of files) {
      if (file.type !== "application/pdf") {
        setFilesError("Only PDF files are allowed.");
        return false;
      }
    }
    setFilesError("");
    return true;
  };

//  useEffect(() => {
//   if (!activeOrigin) return; // ✅ don’t fetch when origin cleared manually
//   axios
//     .get("http://localhost:8081/next-control-number", { params: { origin: activeOrigin } })
//     .then((resp) => {
//       if (activeOrigin) setControlNumber(resp.data.control_number);
//     })
//     .catch((err) => console.error("Error fetching next control number:", err));
// }, [activeOrigin]);
  // Handle the day change and reset sequential number
  // const handleDayChange = (e) => {
  //   const newDay = e.target.value;
  //   // Check if the day is a valid number and within the range 1-31
  //   if (newDay < 1 || newDay > 31) {
  //     setDayError("Please enter a valid day (1-31).");
  //   } else {
  //     setDayError(""); // Clear any previous error if day is valid
  //     setFormData({ ...formData, day: newDay });
  //     // If the day has changed, reset the counter
  //     if (newDay !== lastDay) {
  //       setRecordCounter(1); // Reset the counter to 1 for a new day
  //       setLastDay(newDay); // Store the new day as the last day
  //     }
  //   }
  //   const { name, value } = e.target;
  //   setFormData((prev) => ({
  //     ...prev,
  //     [name]: value,
  //   }));
  // };
  // useEffect(() => {
  //   if (!activeOrigin) return; // Skip fetching if no origin is selected
  //   axios
  //     .get("http://localhost:8081/next-control-number", { params: { origin: activeOrigin } })
  //     .then((resp) => {
  //       setControlNumber(resp.data.control_number); // Set control number from backend response
  //     })
  //     .catch((err) => {
  //       console.error("Error fetching next control number:", err);
  //       setError("Failed to fetch control number. Please try again.");
  //     });
  // }, [activeOrigin]); // Fetch whenever the origin changes

// useEffect(() => {
//   if (!activeOrigin || isResetting) return; // Skip if no origin or resetting
//   console.log("Fetching control number for:", activeOrigin);

//   // Request to backend to get the next control number
//   axios
//     .get("http://localhost:8081/next-control-number", { params: { origin: activeOrigin } })
//     .then((response) => {
//       setControlNumber(response.data.control_number); // Update control number state
//     })
//     .catch((err) => {
//       console.error("Error fetching next control number:", err);
//       setError("Failed to fetch control number. Please try again.");
//     });
// }, [activeOrigin, isResetting]);

useEffect(() => {
  if (!activeOrigin || isResetting) return; // Skip if no origin or resetting

  // Request to backend to get the next control number
  axios
    .get("/next-control-number", { params: { origin: activeOrigin } })
    .then((response) => {
      setControlNumber(response.data.control_number); // Update control number state
    })
    .catch((err) => {
      console.error("Error fetching next control number:", err);
      setError("Failed to fetch control number. Please try again.");
    });
}, [activeOrigin, isResetting]);

// Check for incoming document data from sessionStorage (sent from IncomingDocuments page)
useEffect(() => {
  const incomingStr = sessionStorage.getItem("incomingDoc");
  if (incomingStr) {
    try {
      const incoming = JSON.parse(incomingStr);
      // Pre-fill description and office requestor
      setFormData((prev) => ({
        ...prev,
        description: incoming.description || prev.description,
        office_requestor: incoming.office_from || prev.office_requestor,
      }));
      // Fetch the file from the server and add it to the files state
      if (incoming.file_path) {
        const fileUrl = incoming.file_path.startsWith('/') ? incoming.file_path : '/' + incoming.file_path;
        fetch(fileUrl)
          .then((res) => res.blob())
          .then((blob) => {
            const file = new File([blob], incoming.file_name || 'document.pdf', { type: 'application/pdf' });
            setFiles((prev) => [...prev, file]);
          })
          .catch((err) => console.error('Error fetching incoming file:', err));
      }
      // Clear so it doesn't re-apply on next render
      sessionStorage.removeItem("incomingDoc");
    } catch (e) {
      console.error('Error parsing incoming doc data:', e);
      sessionStorage.removeItem("incomingDoc");
    }
  }
}, []);

//   const handleDayChange = (e) => {
//   const newDay = e.target.value;
//   if (newDay < 1 || newDay > 31) {
//     setDayError("Please enter a valid day (1-31).");
//   } else {
//     setDayError("");
//     if (newDay !== lastDay) {
//       setRecordCounter(1);
//       setLastDay(newDay);
//     }
//   }
//   const { name, value } = e.target;
//   setFormData(prev => ({
//     ...prev,
//     [name]: value,
//   }));
// };
// Handle day change and increment record counter


// const handleSubmit = async (e) => {
//   e.preventDefault();
//  console.log("handleSubmit triggered ✅");
//   // Ensure control number is generated and included in the form data
//   const payload = {
//     ...formData,
//     control_number: controlNumber,
//     current_office: "Office of the President",
//   };

//   // Reset any previous errors
//   setError(null);
//   setFilesError(""); // Reset file error message

//   // Check form validity
//   const formEl = formRef.current;
//   if (!(formEl?.checkValidity?.() ?? true)) {
//     setValidated(true);
//     return;
//   }

//   // Set destination_office to "Office of the President" before submitting
//   const updatedFormData = {
//     ...payload,
//     destination_office: "Office of the President",
//   };

//   // Remove the day field from the form data if it's not needed
//   delete updatedFormData.day;

//   try {
//     const fd = new FormData();

//     // Append updatedFormData fields to FormData object
//     Object.entries(updatedFormData).forEach(([k, v]) => {
//       if (v) {
//         fd.append(k, v);
//       }
//     });

//     // Make API call to create the record
//     const response = await axios.post("http://localhost:8081/records", fd, {
//       headers: { "Content-Type": "multipart/form-data" },
//       onUploadProgress: (evt) => {
//         if (evt.total) setUploadPct(Math.round((evt.loaded * 100) / evt.total));
//       },
//     });

//     // Success handling
//     console.log("Record created successfully", response.data);

//     // Call resetForm() to clear the form after successful submission
//     resetForm(); // Ensure this is called after the API request

//     alert("Record created successfully!");
//   } catch (err) {
//     console.error("API Request Error:", err);
//     setError("Failed to create record. Please try again later.");
//   } finally {
//     setSaving(false);
//   }
// };

// const resetForm = () => {
//   console.log("Resetting form...");
// console.log("resetForm CALLED ✅");
//   // clear origin FIRST (prevents re-fetch)
//   setActiveOrigin("");      

//   setFormData({
//     office_requestor: "",
//     classification: "",
//     priority: "",
//     description: "",
//     current_office: "",
//     day: "",
//     retention_period: "",
//     control_number: "",
//     record_origin: "",
//   });

//   setControlNumber("");      
//   setFiles([]);
//   setUploadPct(0);
//   setValidated(false);
//   setFilesError("");
//   setError(null);
//   setRecordCounter(1);
//   setLastDay("");
//   setDayError("");

//   setFormKey(prev => prev + 1);
//   console.log("Form reset completed");
// };

// useEffect(() => {
//   if (isResetting || !activeOrigin) return;
//   // fetchControlNumber(activeOrigin);
// }, [activeOrigin, isResetting]);
const handleSubmit = async (e) => {
  e.preventDefault();
  setSaving(true);
  setError(null);
  setFilesError(""); // Clear previous file errors

  // Validate attachments before submitting
  if (!validateFiles()) {
    setSaving(false);
    return;
  }

  // Explicit field validation — block if any required field is empty
  const requiredFields = {
    control_number: controlNumber,
    office_requestor: formData.office_requestor,
    description: formData.description,
    classification: formData.classification,
    priority: formData.priority,
    destination_office: formData.destination_office,
    record_origin: formData.record_origin,
  };
  const missingFields = Object.entries(requiredFields)
    .filter(([, v]) => !v || String(v).trim() === '')
    .map(([k]) => k.replace(/_/g, ' '));
  if (missingFields.length > 0) {
    setError(`Please fill in all required fields: ${missingFields.join(', ')}`);
    setSaving(false);
    return;
  }

  // At least one file attached
  if (!files || files.length === 0) {
    setFilesError('At least one PDF file is required.');
    setSaving(false);
    return;
  }

  const formEl = formRef.current;
  if (!(formEl?.checkValidity?.() ?? true)) {
    setValidated(true);
    setSaving(false);  // Ensure saving state is stopped if validation fails
    return;
  }

  try {
    const fd = new FormData();

    // Append the form fields (skip empty ones). control_number,
    // current_office, and destination_office are appended exactly once below
    // — appending them here too would send duplicate multipart fields, which
    // multer turns into arrays and breaks the records INSERT.
    const EXPLICIT_FIELDS = [
      "control_number",
      "current_office",
      "destination_office",
    ];
    Object.entries(formData).forEach(([k, v]) => {
      if (EXPLICIT_FIELDS.includes(k)) return;
      if (v !== undefined && v !== null && v !== "") fd.append(k, v);
    });
    fd.append("control_number", controlNumber);
    fd.append("current_office", "Office of the President");
    fd.append(
      "destination_office",
      formData.destination_office || "Office of the President"
    );

    // Append the attachments
    files.forEach((file) => fd.append("files", file));

    const response = await axios.post("/records", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });

    // Check if the response is successful
    if (response.status >= 200 && response.status < 300) {
      resetForm();
      alert("Record created successfully!");
    } else {
      throw new Error(`Unexpected status: ${response.status}`);
    }
  } catch (err) {
    console.error("API Request Error:", err);
    setError(
      err.response?.data?.error ||
        "Failed to create record. Please try again later."
    );
  } finally {
    setSaving(false); // Ensure button is reset
  }
};

// const handleSubmit = async (e) => {
//   e.preventDefault();
//   setSaving(true);
//   setError(null);
//   setFilesError(""); // Clear previous file errors

//   const formEl = formRef.current;
//   if (!(formEl?.checkValidity?.() ?? true)) {
//     setValidated(true);
//     setSaving(false);  // Ensure saving state is stopped if validation fails
//     return;
//   }

  
//   // Increment the record counter
//   setRecordCounter((prevCounter) => {
//     const newCounter = prevCounter + 1;
//     const generatedControlNumber = generateControlNumber(recordCounter); // Generate control number using updated counter
//     // Update the formData with the new control number
//     setFormData((prevFormData) => ({
//       ...prevFormData,
//       control_number: generatedControlNumber,  // Update control number in the formData state
//     }));

//     return newCounter;
//   });

//   const generatedControlNumber = generateControlNumber(recordCounter); // Ensure control number reflects the latest state

//   const payload = {
//     ...formData,
//     control_number: generatedControlNumber, // Ensure control number is included
//     current_office: "Office of the President", // You can keep this hardcoded or dynamic
//   };

//   const updatedFormData = {
//     ...payload,
//     destination_office: "Office of the President",
    
//   };

//   const { day, ...cleanedFormData } = updatedFormData;

//   try {
//     const fd = new FormData();

//     // Append fields to FormData
//     Object.entries(cleanedFormData).forEach(([k, v]) => {
//       if (v !== undefined && v !== null) fd.append(k, v);
//     });

//     const response = await axios.post("http://localhost:8081/records", fd, {
//       headers: { "Content-Type": "multipart/form-data" },
//       onUploadProgress: (evt) => {
//         if (evt.total) setUploadPct(Math.round((evt.loaded * 100) / evt.total));
//       },
//     });

//     // Check if the response is successful
//     if (response.status >= 200 && response.status < 300) {
//       console.log("Record created successfully", response.data);
//       resetForm();
//       alert("Record created successfully!");
//     } else {
//       throw new Error(`Unexpected status: ${response.status}`);
//     }
//   } catch (err) {
//     console.error("API Request Error:", err);
//     setError("Failed to create record. Please try again later.");
//   } finally {
//     setSaving(false); // Ensure button is reset
//   }
// };




const resetForm = () => {
  setIsResetting(true);

  // Stop any origin-driven side effects
  setActiveOrigin("");

  // Reset form data
  setFormData({
    office_requestor: "",
    classification: "",
    priority: "",
    description: "",
    current_office: "",
    concerned_personnel: "",
    destination_office: "",
    retention_period: "",
    control_number: "",
    record_origin: "",
  });

  // Clear derived states
  setControlNumber("");
  setFiles([]);
  setValidated(false);
  setFilesError("");
  setError(null);

  // Reset uncontrolled inputs (e.g., file inputs)
  formRef.current?.reset?.();
  if (fileInputRef.current) fileInputRef.current.value = null;

  // Force remount custom components if needed
  setFormKey((prev) => prev + 1);

  setTimeout(() => setIsResetting(false), 50);
};



  return (
    <div className="d-flex">
      <Sidebar />
      <div className="flex-grow-1">
        <Navbar />
        <div className="container p-3">
          <h2>Create New Record</h2>
          {error && <div className="alert alert-danger">{error}</div>}

          <div className="record-form-card">
          <div className="mb-3 d-flex gap-2">
            {ORIGIN_OPTIONS.map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => handleOriginSwitch(opt)}
                className={`btn ${
                  activeOrigin === opt ? "btn-primary" : "btn-outline-primary"
                }`}
              >
                {opt}
              </button>
            ))}
          </div>
          <div >
            <form
              ref={formRef}
              key={formKey}
              className={`row g-3 ${validated ? "was-validated" : ""}`}
              onSubmit={handleSubmit}
              encType="multipart/form-data"
              noValidate
            >
              {/* Control No */}
              <div className="col-md-6">
                <label className="form-label">Control No. *</label>
                <input
                  className="form-control"
                  name="control_number"
                  pattern="[A-Za-z0-9._\-\/]+"
                  value={controlNumber}
                  onChange={handleChange}
                  placeholder="e.g., 2025-09-001"
                  required
                  autoComplete="off"
                  readOnly
                />
                <div className="invalid-feedback">
                  Control number is required.
                </div>
                <div className="form-text">
                  Letters, numbers, -, _, /, . allowed
                </div>
              </div>
              {/* Day (User Defined) */}
              {/* <div className="col-md-4">
                <label className="form-label">Day</label>
                <input
                  type="number"
                  className="form-control"
                  name="day"
                  value={formData.day ?? ""}
                  onChange={handleDayChange}
                  placeholder="Enter Day"
                />
              </div> */}

              <AutocompleteInput
                key={`${formKey}-office_requestor`}
                label="Office/Requestor"
                name="office_requestor"
                value={formData.office_requestor ?? ""}
                onChange={handleChange}
                options={DESTINATION_OFFICES}
                placeholder="Select Office/Requestor"
                required
              />

              {/* Description */}
              <div className="col-12">
                <label className="form-label">Title and Description *</label>
                <textarea
                  className="form-control"
                  name="description"
                  rows={2}
                  value={formData.description ?? ""}
                  onChange={handleChange}
                  required
                ></textarea>
                <div className="invalid-feedback">Description is required.</div>
              </div>

              <AutocompleteInput
                key={`${formKey}-classification`}
                label="Classification"
                name="classification"
                value={formData.classification ?? ""}
                onChange={handleChange}
                options={CLASSIFICATION_OPTIONS}
                placeholder="e.g., Academic"
              />
              <AutocompleteInput
                key={`${formKey}-priority`}
                label="Priority"
                name="priority"
                value={formData.priority ?? ""}
                onChange={handleChange}
                options={PRIORITY_OPTIONS}
                placeholder="e.g., Normal"
              />

              {/* Concerned Personnel */}
              <AutocompleteInput
                key={`${formKey}-concerned_personnel`}
                label="Concerned Personnel"
                name="concerned_personnel"
                value={formData.concerned_personnel ?? ""}
                onChange={handleChange}
                options={CONCERNED_PERSONNEL}
                placeholder="Select Concerned Personnel"
                required={false}
              />

              {/* Destination Office */}
              <AutocompleteInput
                key={`${formKey}-destination_office`}
                label="Destination Office"
                name="destination_office"
                value={formData.destination_office ?? ""}
                onChange={handleChange}
                options={DESTINATION_OFFICES}
                placeholder="Select Destination Office"
              />

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
                    PDF attachments (optional)
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

              {/* Submit */}
              <div className="col-12 d-flex gap-2">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Create Record"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={saving}
                  onClick={() => window.history.back()}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}
