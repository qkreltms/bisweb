const $ = require('jquery');
const localforage = require('localforage');
const webutil = require('bis_webutil.js');
require('jstree');

/**
 * When loading a file from the server, the user must be able to browse the files. 
 * This class will render a list of files in a window similar to the file system dialog that opens when a user clicks on an <input type='file'> button.
 * 
 * The dialog will contact the server to request image files that the user selects or to request information about the filesystem that the browser does not currently have (the server does not send info about the whole filesystem on the initial request).
 * 
 * TODO: Back button breaks after adding supplemental files
 */
class FileDialogElement {

    constructor(modalName = 'File Tree', options = {}) {

        this.addDefaultOptions(options);
        this.modalType = options.modalType;
        this.displayFiles = options.displayFiles;

        this.modal = webutil.createmodal(modalName, 'modal-lg');

        this.contentDisplayTemplate = 
        `<div class='col-sm-9 file-display'>
            <div><p>Content goes here...</p></div>
        </div>`;

        this.fileList = null;
        this.currentPath = null;
        this.currentDirectory = null;
        this.filters='';
        this.lastDirectories = [];
        this.lastPaths = [];

        //make the skeleton for the box
        this.container = $(
                        `<div class='container-fluid'>
                            <div class='row justify-content-start'>
                                <div class='col-12 file-navbar'>
                                </div>
                            </div>
                            <div class='row justify-content-start content-box'>
                                <div class='col-sm-3 favorite-bar'>
                                </div>

                                <div class='col-sm-9 file-display'>
                                    <div class='file-list'><p>Content goes here...</p></div>
                                </div>
                        </div>`
                        );

/*        this.container.css({ 'max-height' : '200px',
          "overflow-y": "auto",
          });*/
        
        this.createStaticElements(options);
        this.modal.body.append(this.container);
    }

    /**
     * Creates the elements of the file dialog that don't need to be redrawn regularly.
     * 
     * @param {Object} options - Options to specify which elements should be drawn to the dialog 
     */

    createStaticElements(options) {

        let favoriteBar = this.container.find('.favorite-bar');

        if (options.makeFavoriteButton) {
            let favoriteButton = $(`<button type='button' class='btn btn-sm btn-link'><span class='glyphicon glyphicon-star-empty'></span> Mark folder as favorite</button>`);
            favoriteBar.append(favoriteButton);

            let pillsHTML = $(`<ul class='nav nav-pills nav-stacked'></ul>`);
            favoriteBar.append(pillsHTML);
    
            let selectPillFromPills = (pill, pills) => {
                for (let otherPill of pills) {
                    $(otherPill).removeClass('active');
                }
                $(pill).addClass('active');
            };

            //TODO: add folder to localforage ...
            favoriteButton.on('click', () => {
                let key = webutil.getuniqueid(), name = this.currentPath[this.currentPath.length - 1];
                let favorite = {
                    'name' : name,
                    'path' : Array.from(this.currentPath),
                    'key' : key
                };

                localforage.setItem(key, JSON.stringify(favorite));

                //create the pill
                let pillsBar = favoriteBar.find('.nav.nav-pills');
                let newPill = $(`<li><a href='#'>${name}</a></li>`);
                newPill.on('click', () => {
                    selectPillFromPills(newPill, pillsBar.find('li'));
                    localforage.getItem(key, (err, value) => {
                        let favoriteFolder;
                        try {
                            favoriteFolder = JSON.parse(value);
                            this.changeDirectory(favoriteFolder.path, this.traversePath(favoriteFolder.path));
                        } catch(e) {
                            console.log('error parsing JSON', value);
                        }

                    });
                });

                pillsBar.append(newPill);
            });
        }

        if (options.modalType === 'save') {
            let saveButton = $(`<button type='button' class='btn btn-success'>Save</button>`);
            saveButton.on('click', () => {
                this.createSaveImageDialog();
            });

            this.modal.footer.append(saveButton);
            this.modal.footer.find('.btn-default').remove();
        } else {
            this.modal.dialog.find('.modal-footer').remove();
        }

        //erase the file list on modal close
        this.modal.dialog.on('hidden.bs.modal', () => {
            let contentDisplay = this.container.find('.file-list');
            contentDisplay.remove();

            this.modal.header.find('.message').empty();

            this.filters = null;
        });
    }
    
    /**
     * Adds the files specified by list to the file dialog. If the dialog is empty this effectively creates the dialog.
     * The list may also specify extra files fetched by the server, in which case startDirectory will designate the path at which they should be added.
     * 
     * NOTE: The file server that creates the file dialog will provide a few of its functions with the socket bound, e.g. fileListFn, to avoid sharing too many of its internal structures.
     * @param {Array} list - An array of file entries. May contain children that are themselves file entries. A list entry may contain the following fields:
     * @param {String} list.text - The name of the file or folder.
     * @param {String} list.type - What type of file or folder the entry represents. One of 'picture', 'html', 'js', 'text', 'video', 'audio', 'file', or 'directory'.
     * @param {String} list.path - The full path indicating where the file is located on the server machine.
     * @param {Array} list.children - File entries for each file contained in the list entry. Only for list entries of type 'directory'.
     * @param {Object} startDirectory - File entry representing the directory at which the files in list should be added. Undefined means the files represent the files in the user's home directory (~/).
     */
    createFileList(list, startDirectory = null,opts=null) {

        if (opts!==null) {
            this.filters=opts.suffix || '';
            let newtitle=opts.title || null;
            console.log('filters=',this.filters,this.title);

            if (newtitle) {
                let title = this.modal.header.find('.modal-title');
                title.text(newtitle+ ' (using bisweb fileserver)');
            }
        }
        
        //file list is constructed as more files are fetched -- the first request will provide a certain number of files then supplemental requests will build it up.
        //createFileList will be called to make the list from scratch, but should not alter the list after that.
        this.fileList = this.fileList ? this.fileList : list;
        this.currentDirectory = list;

        this.lastDirectories = [];
        this.lastPaths = [];

        //keep track of the current directory for the navbar
        this.currentPath = startDirectory ? startDirectory.path.split('/') : [];
        this.container.find('.file-navbar').empty();

        if (startDirectory) {
            this.expandDirectory(startDirectory.list);
        } else {
            this.expandDirectory(list);
        }   
    }

    /**
     * Creates the visual representation of the files specified by list. Called from createFileList (see notes there for format of file entries).
     * Uses jstree to render the list.
     * 
     * Sorts contents before display so that folders are shown first.
     * @param {Array} list - An array of file entries. 
     */
    expandDirectory(list) {
        let fileList = this.container.find('.file-list');
        let fileDisplay = this.container.find('.file-display');

        fileList.remove();
        let newList = $(`<div class='file-list'></div>`);

        newList.css({ 'max-height' : '200px',
                      'max-width'  : '600px',
                      "overflow-y": "auto",
                      "overflow-x": "auto",
                      "color" : "#0ce3ac",
                      "background-color": "#444444"
                    });


        //sort folders ahead of files
        list.sort( (a, b) => {
            if (a.type === 'directory') {
                if (b.type === 'directory')
                    return 0;
                else return -1;
            } else if (b.type === 'directory') {
                return 1;
            } else {
                return 0;
            }
        });

        if (!this.displayFiles) {
            for (let i = 0; i < list.length; i++) {
                if (list[i].type !== 'directory') {
                    list.splice(i, 1);
                    i--;
                } 
            }
        }


        
        newList.jstree({
            'core': {
                'data': list,
                'dblclick_toggle': false
            },
            'types': {
                'default': {
                    'icon': 'glyphicon glyphicon-file'
                },
                'file': {
                    'icon': 'glyphicon glyphicon-file'
                },
                'root': {
                    'icon': 'glyphicon glyphicon-home'
                },
                'directory': {
                    'icon': 'glyphicon glyphicon-folder-close'
                },
                'picture': {
                    'icon': 'glyphicon glyphicon-picture'
                },
                'js': {
                    'icon': 'glyphicon glyphicon-file'
                },
                'html': {
                    'icon': 'glyphicon glyphicon-tasks'
                },
                'video': {
                    'icon': 'glyphicon glyphicon-film'
                },
                'text': {
                    'icon': 'glyphicon glyphicon-list-alt'
                }
            },
            'plugins': ["types"]
        });

        //determine based on the type of the node what should happen when the user clicks on it
        $(newList).on('select_node.jstree', (event, data) => {
            //check whether node should expand directories beneath it.
            if (data.node.original.expand) {
                this.fileListFn(this.modalType, data.node.original.path);
                return;
            }

            //NOTE: Actual image data is attached later in the case of a save request. Only the file location is provided here.
            let command = this.modalType === 'save' ? 'uploadfile' : 'getfile';
            switch (data.node.type) {
                case 'file': break;
                case 'picture': this.makeFileRequest(command, { 'path' : data.node.original.path }); break;
                case 'directory': {
                    let name = data.node.original.text;
                    let node = this.currentDirectory.find((element) => { return element.text === name; });
                    if (node) {
                        this.changeDirectory(node.text, node.children);
                    } else {
                        console.log('Error, could not find element with name', data.node.original.text, 'in directory', this.currentDirectory);
                    }
                    break;
                }
                default: console.log('clicked on node', data.node.type, 'that performs no action');
            }

        });

        this.updateFileNavbar();
        fileDisplay.append(newList);
    }

    /**
     * Updates the list of folders at the top of the file dialog to reflect the folders in the current path.
     */
    updateFileNavbar() {
        let navbar = this.modal.body.find('.file-navbar');

        //leading character may be a '/', in this case just strip out the empty entry it creates and start from the first folder name
        if (this.currentPath[0] && this.currentPath[0] === '') { this.currentPath.splice(0,1); }
        navbar.empty();
        
        let backButton = $(`<button type='button' class='btn btn-sm btn-link'><span class='glyphicon glyphicon-chevron-left'></span> back</button>`);
        backButton.on('click', () => {
            this.backOneDirectory();
        });

        //create 'home' button that will bring user back to ~/
        let homeButton = $(`<button type='button' class='btn btn-sm btn-link'><span class='glyphicon glyphicon-folder-close'></span> home</button>`);
        homeButton.on('click', () => {
            this.changeDirectory(null, this.fileList);
        });

        navbar.append(backButton);
        navbar.append(homeButton);

        //create navbar buttons for each folder in the current path
        for (let folder of this.currentPath) {
            let button = $(`<button type='button' class='btn btn-sm btn-link'><span class='glyphicon glyphicon-folder-close'></span> ${folder}</button>`);
            button.on('click', () => {
                
                let newPath = Array.from(this.currentPath);
                //set the current path to the path up to the button that was clicked. 
                //e.g. if the path is javascript/bisweb/node_modules and bisweb is clicked, set currentPath to javascript/bisweb
                for (let i = 0; i < newPath.length; i++) { 
                    if (newPath[i] === folder) { 
                        newPath = newPath.slice(0, i + 1);
                        break;
                    }
                }

                //find the contents of the new path
                let newPathContents = this.fileList, foundEntry = false;
                for (let entry of newPath) {
                    for (let file of newPathContents) {
                        if (file.text === entry) { 
                            newPathContents = file.children; 
                            foundEntry = true;
                            break;
                        }
                    }

                    if (!foundEntry) { 
                        console.log('Error trying to traverse new file path', newPath, ', could not find entry', entry, 'in folder', newPathContents);
                        return;
                    }

                    foundEntry = false;
                }

                console.log('newPath', newPath);
                this.changeDirectory(newPath, newPathContents);
            });

            navbar.append(button);
        }
    }

    /**
     * Displays the file dialog to the user. 
     * 
     * @param {String} filters - The list of acceptable file types to use with this modal, separated by commas.
     * @param {String} modalTitle - The title to display in the header of the modal. 
     */
    showDialog(filters, modalTitle = null) {
        if (modalTitle) {
            let title = this.modal.header.find('.modal-title');
            title.remove();
            let newTitle = $(`<h4 class='modal-title'>${modalTitle}</h4>`);
            this.modal.header.append(newTitle);
        }

        this.filters = filters;
        this.modal.dialog.modal('show');
    }

    /**
     * Opens the contents of a directory into the file dialog and updates internal structures to reflect the change. 
     * 
     * @param {String|Object|null} name - The name of the folder being opened, a full path for a folder, or null. If null it sets the current path to ~/
     * @param {Array} contents - The contents of the folder being opened. 
     */
    changeDirectory(name, contents) {
        this.lastDirectories.push(this.currentDirectory);
        this.currentDirectory = contents;

        //deep copy to avoid referencing issues
        let lastPath = Array.from(this.currentPath);

        if (name === null) {
            this.lastPaths.push(lastPath);
            this.currentPath = [];
        } else if (typeof(name) === 'string') { 
            this.lastPaths.push(lastPath);
            this.currentPath.push(name);
        } else if (typeof(name) === 'object') {
            this.lastPaths.push(lastPath);
            this.currentPath = name;
        } else {
            console.log('received unexpected name', name);
            return;
        }

        this.expandDirectory(contents);
    }

    /**
     * Goes 'back' one directory, showing the last filepath and file contents that were displayed in the file dialog. Does nothing if lastPaths or lastDirectories is empty.
     */
    backOneDirectory() {
        if (this.lastPaths.length > 0 && this.lastDirectories.length > 0) {
            let lastPath = this.lastPaths.pop();
            let lastDirectory = this.lastDirectories.pop();

            this.currentPath = lastPath;
            this.currentDirectory = lastDirectory;

            this.expandDirectory(lastDirectory);
        }
    }

    /** 
     * Tries to expand a filepath using files contained by the file dialog.
     * 
     * @returns The file entry representing the folder specified by path. 
     */
    traversePath(path) {
        let list = this.fileList;
        let foundFolder = false;

        for (let folder of path) {
            for (let item of list) {
                if (item.text === folder) {
                    list = item.children;
                    foundFolder = true;
                }
            }
            if (!foundFolder) { console.log('could not find folder with path', path); return null; }
            foundFolder = false;
        }

        return list;
    }

    makeFileRequest(command, params) {
        let header = this.modal.header;

        let messageText;
        switch (command) {
            case 'getfile' : 
            case 'getfiles' : messageText = 'Loading file, please wait...'; break;
            case 'uploadfile' : 
            case 'uploadfiles' : messageText = 'Saving file, please wait...'; break;
        }

        let loadingMessage = $(`<p class='message'>${messageText}</p>`);
        header.append(loadingMessage);

        let cb = () => {
            header.find('.message').remove();
        };

        let eb = () => {
            header.find('.message').remove();
            let errorMessage = $(`<p class='errorMessage'>An error occured. Please ensure the chosen file exists in the chosen location.</p>`);
            header.append(errorMessage);

            setTimeout( () => { 
                header.find('.errorMessage').remove(); 
            }, 5000);
        };

        //strip out leading '/' if necessary 
        let name = params.path.charAt(0) === '/' ? params.path.substring(1) : params.path;
        console.log('params.path', params.path, 'name', name);

        //params.path duplicated because different fileRequestFns may reference the filename differently, e.g. Amazon AWS provides one fileRequestFn, bisweb_fileserver provides another...
        this.fileRequestFn({ 'command' : command, 'files' : [name], 'name' : name, 'paths' : [params.path] }, cb, eb);
    }

    /**
     * Creates a small modal dialog to allow the user to enter the name for a file they are attempting to save.
     * 
     * NOTE: This function is meant to be called exclusively by the Save button created by the file save modal. It will not work as intended anywhere else! 
     */
    createSaveImageDialog() {
        let saveDialog = $(`<p>Please enter a name for the current image on the viewer.</p>`);
        let nameEntryBox = $(`
                <div class='form-group'>
                    <label for='filename'>Filename:</label>
                    <input type='text' class = 'form-control'>
                </div>
            `);

        if (!this.saveImageModal) {
            this.saveImageModal = webutil.createmodal('Save Current Image?', 'modal-sm');
            this.saveImageModal.dialog.find('.modal-footer').find('.btn').remove();

            let confirmButton = webutil.createbutton({ 'name': 'Confirm', 'type': 'btn-success' });
            let cancelButton = webutil.createbutton({ 'name': 'Cancel', 'type': 'btn-danger' });

            this.saveImageModal.footer.append(confirmButton);
            this.saveImageModal.footer.append(cancelButton);

            $(confirmButton).on('click', () => {
                let name = this.saveImageModal.body.find('.form-control')[0].value;

                //update the modal with a success message after successful transmission.
                let cb = () => {
                    let transmissionCompleteMessage = $(`<p>Upload completed successfully.</p>`);

                    this.saveImageModal.body.empty();
                    this.saveImageModal.body.append(transmissionCompleteMessage);

                    //save modal should close once upload is complete
                    this.saveImageModal.dialog.one('hidden.bs.modal', () => {
                        this.modal.dialog.modal('hide');
                    });

                    setTimeout(() => { this.saveImageModal.dialog.modal('hide'); }, 1500);
                };

                //update modal with an error message if things went wrong
                let eb = () => {
                    let errorMessage = $(`<p>An error occured during transmission. File not uploaded.</p>`);

                    this.saveImageModal.body.empty();
                    this.saveImageModal.body.append(errorMessage);

                    setTimeout(() => { this.saveImageModal.dialog.modal('hide'); }, 1500);
                };

                name = this.fixFilename(name, this.filters);

                //turn the filename into the full filepath
                let currentPath = this.currentPath.join('/');
                let newFilename = currentPath.length > 1 ? currentPath + '/' + name : name;

                this.fileRequestFn( { 'command' : 'uploadfile', 'name' : newFilename }, cb, eb);

                let imageSavingDialog = $(`<p>Uploading image...</p>`);
                this.saveImageModal.body.empty();
                this.saveImageModal.body.append(imageSavingDialog);
            });

            $(cancelButton).on('click', () => {
                this.saveImageModal.dialog.modal('hide');
            });

            //clear name entry input when modal is closed
            $(this.saveImageModal.dialog).on('hidden.bs.modal', () => {
                this.saveImageModal.body.empty();
            });
        }

        this.saveImageModal.body.append(saveDialog);
        this.saveImageModal.body.append(nameEntryBox);

        this.saveImageModal.dialog.modal('show');
    }

    /**
     * Checks a proposed filename against a set of file extension filters to determine whether name should have another kind of filetype applied to it.
     * 
     * @param {String} name - A tentative filename
     * @param {String} filters - A set of file extensions separated by commas.
     * @returns A properly formatted filename
     */
    fixFilename(name, filters='') {

        let splitFilters = filters.split(',');
        let splitName = name.split('.');
        
        console.log('name', splitName, 'filters', splitFilters);
        if (splitName.length < 1)
            return name + splitFilters[0];
        
        //check specifically for .nii.gz
        if (splitName.length > 2 && splitName[splitName.length - 2] === 'nii' && splitName[splitName.length -1] === 'gz'){
            for (let filter of filters) {
                if (filter === '.nii.gz') {
                    return name;
                }
            }
        }

        //check if extension matches one of the filters
        for (let filter of filters) {
            if (splitName[splitName.length - 1] === filter) {
                return name;
            }
        }
        
        return splitName[0] + splitFilters[0];
    }
    //REPLACED BY makeFileRequest
    /**
     * Requests a file from the server and notifies the user with a message once the file has loaded.
     *
     * @param {String} path - Path of the file on the server machine.
     */
     /*
    fetch(path) {
        let header = this.modal.header;
        let loadingMessage = $(`<p class='loadMessage'>Loading...</p>`);
        header.append(loadingMessage);
        //check value of viewer slider
        let viewerToggle = $(this.container).find('.viewertoggle').find('input');
        console.log('viewer slider', viewerToggle);

        let viewer = (viewerToggle[0] && viewerToggle[0].checked) ? 'viewer2' : 'viewer1';

        let cb = () => {
            header.find('.loadMessage').remove();
        };

        let eb = () => {
            header.find('.loadMessage').remove();
            let errorMessage = $(`<p class='errorMessage'>An error occured while loading the image. Please ensure the chosen file exists in the chosen bucket.</p>`);
            header.append(errorMessage);

            setTimeout( () => { 
                header.find('.errorMessage').remove(); 
            }, 5000);
        };
        //'path' duplicated because different fileRequestFns may reference the filename differently, e.g. Amazon AWS provides one fileRequestFn, bisweb_fileserver provides another...
        this.fileRequestFn({ 'command' : 'getfile', 'files' : [path], 'name' : path }, cb, eb);
    }
    */

    /**
     * Saves a file to a cloud service or local fileserver using a function specified externally by the module (fileSaveFn).
     * 
     * @param {String} path - The path to save the file to on the cloud service. 
     * @param {Uint8Array} data - The file to upload to the cloud service 
     */
    /*
    put(path, data) {
        let header = this.modal.header;
        let loadingMessage = $(`<p class='loadMessage'>Loading...</p>`);
        header.append(loadingMessage);

        let cb = () => {
            header.find('.loadMessage').remove();
        };

        let eb = () => {
            header.find('.loadmessage').remove();
            let errorMessage = $(`<p class='errorMessage'>An error occured while loading the image. Please ensure the chosen file exists in the chosen bucket.</p>`);
            header.append(errorMessage);

            setTimeout( () => { 
                header.find('.errorMessage').remove(); 
            }, 5000);
        };

        this.fileRequestFn
    }
    */



    addDefaultOptions(options) {
        if (!options.hasOwnProperty('makeFavoriteButton')) options.makeFavoriteButton = true;
        if (!options.hasOwnProperty('modalType')) options.modalType = 'load';
        if (!options.hasOwnProperty('displayFiles')) options.displayFiles = true;
    }
}

module.exports = FileDialogElement;