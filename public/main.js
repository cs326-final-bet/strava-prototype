const AUTH_COOKIE = 'authenticationToken';

const PAGES = {
    login: {
	   el: document.getElementById('page-login'),
	   onLoad: onLoginPageLoad,
    },
    activitiesList: {
	   el: document.getElementById('page-activities-list'),
	   onLoad: onActivitiesListPageLoad,
    },
    activityView: {
	   el: document.getElementById('page-activity-view'),
	   onLoad: onActivityViewPageLoad,
    },
};

async function setPage(name, args) {
    Object.keys(PAGES).forEach(async pageName => {
	   const page = PAGES[pageName];
	   
	   if (pageName !== name) {
		  // Hide page
		  page.el.classList.add('page-hidden');
	   } else {
		  // Show page and run entrypoint
		  page.el.classList.remove('page-hidden');
		  await page.onLoad(args);
	   }
    });
}

/**
 * From: https://www.tutorialrepublic.com/javascript-tutorial/javascript-cookies.php
 */
function getCookie(name) {
    // Split cookie string and get all individual name=value pairs in an array
    var cookieArr = document.cookie.split(";");
    
    // Loop through the array elements
    for(var i = 0; i < cookieArr.length; i++) {
        var cookiePair = cookieArr[i].split("=");
        
        /* Removing whitespace at the beginning of the cookie name
        and compare it with the given string */
        if(name == cookiePair[0].trim()) {
            // Decode the cookie value and return
            return decodeURIComponent(cookiePair[1]);
        }
    }
    
    // Return null if not found
    return null;
}

(async function main() {
    // Check if authenticated
    const authCookie = getCookie(AUTH_COOKIE);
    if (authCookie === null) {
	   // Not authenticated
	   await setPage('login');
    } else {
	   // Authenticated
	   await setPage('activitiesList');
    }
})()

async function onLoginPageLoad() {
    
}

async function onActivitiesListPageLoad() {
    const actsSelectEl = document.getElementById('activities-select');
    const actsSelectButtonEl = document.getElementById('select-activity-button');

    const actsResp = await fetch('/api/v0/strava/activities');
    if (!actsResp.ok) {
	   console.error(`Failed to get activities: ${actsResp.status}`);
	   return;
    }

    let respBody = await actsResp.json();

    let activities = {};

    respBody.activities.forEach(async act => {
	   // Place option in menu
	   let node = document.createElement("option");
	   
	   node.value = act.id;
	   
	   let txtNode = document.createTextNode(act.name);
	   node.appendChild(txtNode);
	   
	   actsSelectEl.appendChild(node);

	   // Save activity in map
	   activities[act.id] = act;
    });

    actsSelectButtonEl.onclick = async () => {
	   await setPage('activityView', activities[actsSelectEl.value]);
    };
}

async function onActivityViewPageLoad(activity) {
    let map = new OpenLayers.Map('mapbox');
    map.addLayers([ new OpenLayers.Layer.OSM() ]);
    map.setCenter(new OpenLayers.LonLat([activity.start_location[1],
								 activity.start_location[0]])
			   .transform(new OpenLayers.Projection("EPSG:4326"),
					    new OpenLayers.Projection("EPSG:900913")),
			   13);

    let trip = activity.path.map(point => {
	   return new OpenLayers.Geometry.Point(point.lng, point.lat);
    });

    let vector = new OpenLayers.Layer.Vector();
    let geom = new OpenLayers.Geometry.LineString(trip);
    geom = geom.transform(
	   new OpenLayers.Projection("EPSG:4326"),
	   new OpenLayers.Projection("EPSG:900913")
    );
    vector.addFeatures([new OpenLayers.Feature.Vector(geom)]);
    map.addLayers([vector]);
}
