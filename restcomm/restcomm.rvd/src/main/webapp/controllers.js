App.controller('AppCtrl', function ($rootScope, $scope) {
	console.log("Started AppCtrl");
	$rootScope.$on("$routeChangeError", function(event, current, previous, rejection) {
        //console.log(event);
        console.log('on $routeChangeError');
        $scope.rvdError = rejection;
    })
});

App.controller('homeCtrl', function ($scope) {
	
});

App.controller('projectManagerCtrl', function ($scope, $http, $location, $routeParams, $timeout) {
	
	$scope.projectNameValidator = /^[^:;@#!$%^&*()+|~=`{}\\\[\]"<>?,\/]+$/;
	$scope.projectKind = $routeParams.projectKind;
	if ( $scope.projectKind != 'voice' && $scope.projectKind != 'ussd' && $scope.projectKind != 'sms')
		$scope.projectKind = 'voice';
	$scope.error = undefined; 
	$scope.notifications = [];

	
	$scope.refreshProjectList = function() {
		$http({url: 'services/manager/projects/list',
				method: "GET"
		})
		.success(function (data, status, headers, config) {
			$scope.projectList = data;
			for ( var i=0; i < $scope.projectList.length; i ++)
				$scope.projectList[i].viewMode = 'view';
		});
	}
	
	$scope.createNewProject = function(name, kind) {
		$http({url: 'services/manager/projects?name=' + name + "&kind=" + kind,
				method: "PUT"
		})
		.success(function (data, status, headers, config) {
			console.log( "project created");
			$location.path("/designer/" + name);
		 })
		 .error(function (data, status, headers, config) {
			if (status == 409) {
				console.log("project already exists");
				$scope.notifications.unshift({message:"A Voice, SMS or USSD project  with that name already exists" });
				$timeout(function () {
					$scope.notifications.pop(); 
				}, 5000);
			}
		 });
	}
	
	
	$scope.editProjectName = function(projectItem) {
		projectItem.viewMode = 'edit';
		projectItem.newProjectName = projectItem.name;
		projectItem.errorMessage = "";
	}
	
	$scope.applyNewProjectName = function(projectItem) {
		if ( projectItem.name == projectItem.newProjectName ) {
			projectItem.viewMode = 'view';
			return;
		}
		$http({ method: "PUT", url: 'services/manager/projects/rename?name=' + projectItem.name + "&newName=" + projectItem.newProjectName })
			.success(function (data, status, headers, config) { 
				console.log( "project " + projectItem.name + " renamed to " + projectItem.newProjectName );
				projectItem.name = projectItem.newProjectName;
				projectItem.viewMode = 'view';
				
			})
			.error(function (data, status, headers, config) {
				if (status == 409)
					projectItem.errorMessage = "Project already exists!";
				else
					projectItem.errorMessage = "Cannot rename project";
			});
	}
	
	$scope.deleteProject = function(projectItem) {
		$http({ method: "DELETE", url: 'services/manager/projects/delete?name=' + projectItem.name })
		.success(function (data, status, headers, config) { 
			console.log( "project " + projectItem.name + " deleted " );
			$scope.refreshProjectList();
			projectItem.showConfirmation = false;
		})
		.error(function (data, status, headers, config) { console.log("cannot delete project"); });		
	}
	
    $scope.refreshProjectList();	
	
});


App.controller('designerCtrl', function($scope, $q, $routeParams, $location, stepService, protos, $http, $timeout, $upload, usSpinnerService, $injector, stepRegistry, stepPacker) {
	
	$scope.logger = function(s) {
		console.log(s);
	};
		
	// console.log("routeParam:");
	// console.log( $routeParams );
	
	$scope.stepService = stepService;
	$scope.protos = protos;
	
	// Prototype and constant data structures
	$scope.languages = [
	                    {name:'bf',text:'Belgium-French'},
	                    {name:'bp',text: 'Brazilian-Portugues'},
	                    {name:'en-gb',text: 'British-English'},
	                    {name:'cf',text: 'Canadian-French'},
	                    {name:'cs',text: 'Czech'},
	                    {name:'dan',text: 'Dannish'},
	                    {name:'en',text:'English'},
	                    {name:'fi',text: 'Finnish'},
	                    {name:'es',text: 'Spanish'},
	                    {name:'fr',text: 'French'},
	                    {name:'de',text: 'German'},
	                    {name:'el',text: 'Greek'},
	                    {name:'it',text: 'Italian'},
	                    {name:'nl',text: 'Netherlands-Dutch'},
	                    {name:'no',text: 'Norwegian'},
	                    {name:'pl',text: 'Polish'},
	                    {name:'pt',text: 'Portuguese'},
	                    {name:'ru',text: 'Russian'},
	                    {name:'ar',text: 'Saudi-Arabia Arabic'},
	                    {name:'ca',text: 'Spain Catalan'}, 
	                    {name:'sv',text: 'Swedish'},
	                    {name:'tr',text: 'Turkish'}
	                    
	                   ];
	$scope.methods = ['POST', 'GET'];
	
	$scope.ussdMaxEnglishChars = 182;
	$scope.ussdMaxForeignChars = 91;
		
	// State variables
	$scope.projectError = null; // SET when opening a project fails
	$scope.projectName = $routeParams.projectName;
	$scope.startNodeName = 'start';
	
	
	$scope.nodes = [];		
	$scope.activeNode = 0 	// contains the currently active node for all kinds
							// of nodes
	$scope.lastNodesId = 0	// id generators for all kinds of nodes
	$scope.wavList = [];
	
	// Project management
	$scope.projectList = [];
	
	$scope.spinnerSettings = {
		radius: 4,
		lines: 7,
		length: 5,
		width: 3,
	};
	
	// Some constants to be moved elsewhere = TODO
	$scope.yesNoBooleanOptions = [{caption:"Yes", value:true}, {caption:"No", value:false}];
	$scope.nullValue = null;
	$scope.rejectOptions = [{caption:"busy", value:"busy"}, {caption:"rejected", value:"rejected"}];

	// console.log("projectController stepService: " + stepService.stepNames );


	// Functionality
	// ------------------

	$scope.loseFocus = function () {
		// console.log('lost focus');
	}
	
	
	
	// nodes
	$scope.nodeNamed = function (name) {
		for ( var i=0; i<$scope.nodes.length; i++ ) {
			var anynode = $scope.nodes[i];
			if (anynode.name == name)
				return anynode;
		}
		return null;
	}
	$scope.setStartNode = function (name) {
		console.log( 'set start node to ' + name );
		$scope.startNodeName = name;
	}
	$scope.startNodeSet = function () {
		if ( typeof($scope.nodeNamed($scope.startNodeName)) !== 'undefined' )
			return true;
		return false;
	}
	$scope.getStartUrl = function () {
		r = new RegExp("^([^#]+/)[^/#]*#");
		m = r.exec(document.baseURI);
		if ( m != null )
			return m[1] + "services/apps/" + $scope.projectName + "/controller";
		return '';
	}

	
	$scope.isActiveNodeByIndex = function ( index) { 
		return index == $scope.activeNode; 
	};
	$scope.isActiveNode = function (node) {
		return $scope.nodes.indexOf(node) == $scope.activeNode;
	}
	$scope.setActiveNodeByIndex = function (newindex) {
		$scope.activeNode = (newindex != -1) ? newindex : 0 ;
	};
	$scope.setActiveNode = function ( node) {
		// console.log( "in setActiveNode" );
		$scope.setActiveNodeByIndex( $scope.nodes.indexOf(node) );
	};
	$scope.setActiveNodeByName = function ( nodename) {
		for ( node in $scope.nodes )
			if ( node.name == nodename ) {
				$scope.setActiveNode( node); // TODO : focus too!
				break;
			}
	};
	$scope.addNode = function( name, kind ) { // kind is based on project kind
		$newnode = angular.copy(protos.nodes[kind]);
		if ( typeof(name) === 'undefined' )
			$newnode.name += ++$scope.lastNodesId;
		else
			$newnode.name = name;
		$scope.nodes.push( $newnode );
		return $newnode;
	};
	$scope.removeNode = function( index) {
		if ( index < $scope.nodes.length ) {
			$scope.nodes.splice(index,1);
			if ( $scope.activeNode == index )
				$scope.setActiveNode(0);
		}
	};
	
	
	$scope.getAllTargets = function() {
		var alltargets = [];
		for ( var i = 0; i < $scope.nodes.length; i++ ) {
			var anynode = $scope.nodes[i];
			alltargets.push( {label: anynode.label, name:anynode.name} );
		}
		return alltargets;	
	}
	

	/*
	 * When targets change, broadcast an events so that all <select syncModel/>
	 * elements update appropriately. It is uses as a workaround for cases when
	 * a selected target is removed thus leaving the <select>'s model out of
	 * sync.
	 */
	$scope.$watch('getAllTargets().length', function(newValue, oldValue) {
		$timeout( function () {
			$scope.$broadcast("refreshTargetDropdowns");
		});
	});
	
	
	// Utility functions
	$scope.getMapValuesByIndex = function (map, index) {
			var values = [];
			for ( var i = 0; i < index.length; i ++ ) {
				if ( typeof (map[ index[i] ]) !== 'undefined' )
					values.push (map [index [i]]);
			}
			return values;
	}

	
	// gather mappings
	$scope.addGatherMapping = function( gatherStep ) {
		// first find max inserted digit
		var max = 0;
		for (var i = 0; i < gatherStep.menu.mappings.length; i ++ )
			if ( gatherStep.menu.mappings[i].digits > max )
				max = gatherStep.menu.mappings[i].digits;
				
		gatherStep.menu.mappings.push({digits:max+1, next:""});
	};
	$scope.removeGatherMapping = function (gatherStep, mapping) {
		gatherStep.menu.mappings.splice( gatherStep.menu.mappings.indexOf(mapping), 1 );
	}
	
	
	// User interface
	$scope.toggleEditControls = function (node) {
		node.iface.edited = !node.iface.edited;
	};
	$scope.areSuccessiveSteps = function (node, index, kind1, kind2) {
		if ( node.steps.length - index >= 2 ) {
			if ( node.steps[index].kind == kind1  &&  node.steps[index+1].kind == kind2 )
				return true;
		} else
		if ( node.steps.length - index == 1 ) {
			if ( node.steps[index].kind == kind1  &&  kind2 == null )
				return true;
		} else
		if ( node.steps.length - index == 0 ) {
			if ( kind1 == null  &&  kind2 == null )
				return true;
		}

		return false;
	};
	
	
	$scope.saveProject = function() {
		var deferred = $q.defer();
		
		var state = $scope.packState();
		$http({url: 'services/manager/projects?name=' + $scope.projectName,
				method: "POST",
				data: state,
				headers: {'Content-Type': 'application/data'}
		})
		.success(function (data, status, headers, config) {
			if ( data == "" || data.success ) {
				deferred.resolve('Project saved');
			} else {
				deferred.reject({type:'validationError', data:data});			
			}
		 }).error(function (data, status, headers, config) {
			 deferred.reject({type:'saveError', data:data});
		 });	
		
		return deferred.promise;
	}
	
	$scope.openProject = function(name) {
		$http({url: 'services/manager/projects?name=' + name,
				method: "GET"
		})
		.success(function (data, status, headers, config) {
			$scope.projectName = name;			
			$scope.unpackState(data);
			if ( $scope.projectKind == 'voice' )
				$scope.refreshWavList(name);
			// maybe override .error() also to display a message?
		 }).error(function (data, status, headers, config) {
			 if ( data.serverError.className == 'IncompatibleProjectVersion' )
				 $location.path("/upgrade/" + name)
			 else
				 $scope.projectError = data.serverError;
		 });
	}
	
	$scope.refreshWavList = function(projectName) {
		$http({url: 'services/manager/projects/wavlist?name=' + projectName, method: "GET"})
		.success(function (data, status, headers, config) {
			console.log('getting wav list')
			// console.log( data );
			$scope.wavList = data;
		});
	}

	$scope.buildProject = function() {
		var deferred = $q.defer();
		
		$http({url: 'services/manager/projects/build?name=' + $scope.projectName, method: "POST"})
		.success(function (data, status, headers, config) {
			deferred.resolve('Build successfull');
		 }).error(function (data, status, headers, config) {
			 deferred.reject('buildError');
		 });
		
		return deferred.promise;
	}
	
	$scope.addAssignment = function(step) {
		console.log("adding assignment");
		step.assignments.push({moduleNameScope: null, destVariable:'', scope:'module', valueExtractor: {accessOperations:[], lastOperation: angular.copy(protos.accessOperationProtos.object)} });
	}
	$scope.removeAssignment = function(step,assignment) {
		step.assignments.splice( step.assignments.indexOf(assignment), 1 );
	}
    
    $scope.addUrlParam = function (step) {
        step.urlParams.push({name:'',value:''});
    }
	$scope.removeUrlParam = function(step,urlParam) {
		step.urlParams.splice( step.urlParams.indexOf(urlParam), 1 );
	}    

	// File upload stuff for play verbs
	$scope.onFileSelect = function($files) {
		    // $files: an array of files selected, each file has name, size, and
			// type.
		    for (var i = 0; i < $files.length; i++) {
		      var file = $files[i];
		      $scope.upload = $upload.upload({

		        url: 'services/manager/projects/uploadwav?name=' + $scope.projectName , // upload.php
																						// script,
																						// node.js
																						// route,
																						// or
																						// servlet
																						// url
		        // method: POST or PUT,
		        // headers: {'headerKey': 'headerValue'},
		        // withCredential: true,
		        // data: {myObj: $scope.myModelObj},
		        file: file,
		        // file: $files, //upload multiple files, this feature only
				// works in HTML5 FromData browsers
		        /*
				 * set file formData name for 'Content-Desposition' header.
				 * Default: 'file'
				 */
		        // fileFormDataName: myFile, //OR for HTML5 multiple upload only
				// a list: ['name1', 'name2', ...]
		        /*
				 * customize how data is added to formData. See
				 * #40#issuecomment-28612000 for example
				 */
		        // formDataAppender: function(formData, key, val){}
		      }).progress(function(evt) {
		        console.log('percent: ' + parseInt(100.0 * evt.loaded / evt.total));
		      }).success(function(data, status, headers, config) {
		        // file is uploaded successfully
		    	  console.log('file uploaded successfully');
		        // console.log(data);
		    	  $scope.$emit("fileupload");
		      });
		      // .error(...)
		      // .then(success, error, progress);
		    }
	};
	
	$scope.$on('fileupload', function(event, data) {
		console.log("caught event fileupload");
		$scope.refreshWavList($scope.projectName);
	});
	
	$scope.deleteWav = function (wavItem) {
		$http({url: 'services/manager/projects/removewav?name=' + $scope.projectName + '&filename=' + wavItem.filename, method: "DELETE"})
		.success(function (data, status, headers, config) {
			console.log("Deleted " + wavItem.filename);
			$scope.$emit('wavfileDeleted', wavItem);
		}).error(function (data, status, headers, config) {
			console.log("Error deleting " + wavItem.filename);
		});
	}
	
	$scope.addDialNoun = function (classAttribute, pos, listmodel) {
		// console.log("adding dial noun");
		r = RegExp("dial-noun-([^ ]+)");
		m = r.exec( classAttribute );
		if ( m != null ) {
			// console.log("adding dial noun - " + m[1]);
			var noun = $injector.invoke([m[1]+'NounModel', function(model){
				return new model();
			}]);	
			$scope.$apply( function ()  {
				listmodel.splice(pos,0, noun);
			});
		}
	}
	
	$scope.removeDialNoun = function (dialstep,noun) {
		dialstep.dialNouns.splice( dialstep.dialNouns.indexOf(noun), 1 );
	}
	
	$scope.addStep = function (classAttribute,pos,listmodel) {
		console.log("Adding step ");
		r = RegExp("button-([^ ]+)");
		m = r.exec( classAttribute );
		if ( m != null ) {
			var step;
			var stepkind = m[1];
			step = $injector.invoke([stepkind+'Model', function(model){
				var stepname = stepRegistry.name();
				return new model(stepname);
			}]);	
			
			console.log("adding step - " + m[1]);
			$scope.$apply( function ()  {
				listmodel.splice(pos,0, step);
			});
		}				
	}
	
	$scope.removeStep = function (step,node_steps,steps) {
		console.log("Removing step");
		var container;
		if ( typeof steps != 'undefined')
			container = steps;
		else
			container = node_steps;
		
		container.splice( container.indexOf(step), 1);
	}
	

	
	$scope.onSavePressed = function() {
		usSpinnerService.spin('spinner-save');
		$scope.clearStepWarnings();
		$scope.saveProject()
		.then( function () { return $scope.buildProject() } )
		.then(
			function () { 
				$scope.addAlert("Project saved", 'success');
				console.log("Project saved and built");
			}, 
			function (reason) { 
				if ( reason.type == 'saveError' ) {
					console.log("Error saving project");
					if (reason.data.serverError.className == 'IncompatibleProjectVersion')
						$scope.addAlert("Error saving project. Project version is incompatible with current RVD version", 'danger');
					else
						$scope.addAlert("Error saving project", 'danger');
				} else if ( reason.type == 'validationError') {
					console.log("Validation error");
					$scope.addAlert("Project saved with validation errors", 'warning');
					var r = /^\/nodes\/([0-9]+)\/steps\/([0-9]+)$/;
					for (var i=0; i < reason.data.errorItems.length; i++) {
						var failurePath = reason.data.errorItems[i].failurePath;
						m = r.exec( reason.data.errorItems[i].failurePath );
						if ( m != null ) {
							console.log("warning in module " + $scope.nodes[ m[1] ].name + " step " + $scope.nodes[ m[1] ].steps[m[2]].name);
							$scope.nodes[ m[1] ].steps[m[2]].iface.showWarning = true;
						}
					}
				} else { console.log("Unknown error");}
			} 
		)
		.finally(function () {
			usSpinnerService.stop('spinner-save');
			// console.log('save finished');
		});
		// .then( function () { console.log('project saved and built')});
	}
	
	$scope.$on('wavfileDeleted', function (event,data) {
		console.log("caught event wavfileDeleted");
		$scope.refreshWavList($scope.projectName);
	});
	
	$scope.alerts = [];
	$scope.addAlert = function(msg, type) {
	  var alert = null;
	  if (typeof type !== 'undefined')
		  alert = {type: type, msg: msg};
	  else
		  alert = {msg: msg};
	  
	  $scope.alerts.push(alert);
	  $timeout( function () { $scope.closeAlert(alert); }, 3000);
	};

	$scope.closeAlert = function(alert) {
	  $scope.alerts.splice($scope.alerts.indexOf(alert),1);
	};
	
	$scope.clearStepWarnings = function () {
		for ( var i=0; i<$scope.nodes.length; i++ ) {
			for (var j=0; j< $scope.nodes[i].steps.length; j++)
				$scope.nodes[i].steps[j].iface.showWarning = false;
		}
	}
	
	
	/* USSDSay / USSDCollect functions */
	
	// cound how many characters are left for a ussd message. Make sure to
	// disable trim on the bound input control
	$scope.countUssdChars = function(text) {
		return text.length;
	}
	
	// count total characters for the UssdCollect
	$scope.countUssdCollectChars = function(step) {
		var counter = 0;
		for (var i = 0; i <  step.messages.length; i ++) {
			counter += step.messages[i].text.length + 1; // +1 for the
															// newline at the
															// end of this
															// message
		}
		return counter;
	}
	
	$scope.getUssdNodeLang = function (node) {
		var lang = "en";
		for ( var i=0; i>node.steps.length; i++ ) {
			var step = node.steps[i];
			if ( step.kind == "ussdLanguage") 
				if (step.language != null  &&  step.language != 'en') {
					lang = step.language;
					break;
				}
		}
		return lang;
	}
	
	$scope.countNodeUssdChars = function (node) {
		var sum = 0;
		for ( var i=0; i<node.steps.length; i++ ) {
			var step = node.steps[i];
			if ( step.kind == "ussdSay" ) 
				sum += $scope.countUssdChars(step.text);
			else
			if ( step.kind == "ussdCollect" )
				sum += $scope.countUssdCollectChars(step)			
		}
		return sum;
	}
	
	$scope.remainingUssdChars = function (node) {
		var total = $scope.countNodeUssdChars(node);
		var remaining = $scope.ussdMaxEnglishChars - total;
		if ( $scope.getUssdNodeLang(node) != 'en' )
			remaining = $scope.ussdMaxForeignChars - total;
		return remaining;
	}
	
	$scope.nestUssdMessage = function (classAttribute, pos, listmodel) {
		$scope.$apply( function ()  {
			var nestedMessage;
			nestedMessage = $injector.invoke(['ussdSayNestedModel', function(model){
				return new model();
			}]);	
			listmodel.splice(pos,0, nestedMessage);
		});
	}
	
	$scope.removeNestedMessage = function (step,nested) {
		step.messages.splice( step.messages.indexOf(nested), 1 );
	}
	
	$scope.packState = function() {
		var state = {header:{}, iface:{}};
		// state.lastStepId = stepService.lastStepId;
		state.lastStepId = stepRegistry.current();
		state.nodes = angular.copy($scope.nodes);
		for ( var i=0; i < state.nodes.length; i++) {
			var node = state.nodes[i];
			for (var j=0; j<node.steps.length; j++) {
				var step = $scope.nodes[i].steps[j];
				var packedStep;
				packedStep = step.pack();
				node.steps[j] = packedStep;

				/*
				 * if (step.kind == "play") { if (step.playType == "local")
				 * delete step.remote; else if (step.playType == "remote")
				 * delete step.local; } else if (step.kind == "ussdCollect") {
				 * if (step.gatherType == "menu") delete step.collectdigits;
				 * else if (step.gatherType == "collectdigits") delete
				 * step.menu; }
				 */
				
			}
		}
		state.iface.activeNode = $scope.activeNode;
		state.lastNodeId = $scope.lastNodesId;
		state.header.startNodeName = $scope.nodeNamed( $scope.startNodeName ) == null ? null : $scope.nodeNamed( $scope.startNodeName ).name;
		state.header.projectKind = $scope.projectKind;	
		state.header.version = $scope.version;
		
		return state;
	}
	
	$scope.unpackState = function (packedState) {
		stepRegistry.reset(packedState.lastStepId);
		for ( var i=0; i < packedState.nodes.length; i++) {
			var node = packedState.nodes[i];
			for (var j=0; j<node.steps.length; j++) {
				var step = stepPacker.unpack(node.steps[j]);
				node.steps[j] = step;
			}
		}
		$scope.nodes = packedState.nodes;
		/*
		 * for ( var i=0; i < $scope.nodes.length; i++) { var packedNode =
		 * $scope.nodes[i]; for (var j=0; j<packedNode.steps.length; j++) { var
		 * step; step = stepPacker.unpack(packedNode.steps[j]); $scope.nodes[i]
		 */
				// if (node.steps[j].kind == 'gather') {
					
				// } elsen
					// step = node.steps[j];
				/*
				 * if (step.kind == "gather") { if (step.gatherType == "menu")
				 * step.collectdigits =
				 * angular.copy(protos.stepProto.gather.collectdigits); else if
				 * (step.gatherType == "collectdigits") step.menu =
				 * angular.copy(protos.stepProto.gather.menu); } else
				 */
				/*
				 * if (step.kind == "play") { if (step.playType == "local")
				 * step.remote = angular.copy(protos.stepProto.play.remote);
				 * else if (step.playType == "remote") step.local =
				 * angular.copy(protos.stepProto.play.local); } else if
				 * (step.kind == "ussdCollect") { if (step.gatherType == "menu")
				 * step.collectdigits =
				 * angular.copy(protos.stepProto.ussdCollect.collectdigits);
				 * else if (step.gatherType == "collectdigits") step.menu =
				 * angular.copy(protos.stepProto.ussdCollect.menu); }
				 */					
			// }
		// }
		$scope.activeNode = packedState.iface.activeNode;
		$scope.lastNodesId = packedState.lastNodeId;
		$scope.startNodeName = packedState.header.startNodeName;	
		$scope.projectKind = packedState.header.projectKind;
		$scope.version = packedState.header.version;
	}
	
		
	// Run the following after all initialization are complete
	
	console.log( "opening project " + $scope.projectName);
	$scope.openProject( $scope.projectName );
		
     
     // UNSORTED
     // -------------
     
     
	$scope.editLabelIfSelected = function (node) {
		if ( $scope.isActiveNode( node ) ) {
			node.iface.editLabel=!node.iface.editLabel;
		}
	}
	

			
});


// add di

