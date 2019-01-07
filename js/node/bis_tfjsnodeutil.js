
/*  LICENSE
 
 _This file is Copyright 2018 by the Image Processing and Analysis Group (BioImage Suite Team). Dept. of Radiology & Biomedical Imaging, Yale School of Medicine._
 
 BioImage Suite Web is licensed under the Apache License, Version 2.0 (the "License");
 
 - you may not use this software except in compliance with the License.
 - You may obtain a copy of the License at [http://www.apache.org/licenses/LICENSE-2.0](http://www.apache.org/licenses/LICENSE-2.0)
 
 __Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.__
 
 ENDLICENSE */

'use strict';

const bistfutil = require('bis_tfutil');
const path=require('path');

const tf=require('@tensorflow/tfjs');

let load=function(trygpu) {
    
    if (trygpu) {
        try {
            let a=require('@tensorflow/tfjs-node-gpu');
            console.log('**** Using tfjs-node-gpu',a.version);
            return new bistfutil.TFWrapper(tf);
        } catch(e) {
            console.log('**** Failed to get tfjs-node-gpu, trying CPU version');
        }
    }
    
    try {
        let a=require('@tensorflow/tfjs-node');
        console.log('**** Using tfjs-node',a.version);
        return new bistfutil.TFWrapper(tf);
    } catch(e) {
        console.log('**** Failed to get tfjs-node. Exiting.');
        process.exit(1);
    }
    return null;
};

let reconstruct=function(tfWrapper,img,modelname,batchsize,padding) {

    let URL='file://'+path.normalize(path.resolve(modelname));
    console.log('**** Model URL=',URL,"\n**** Image=",img.getDescription());
    return bistfutil.reconstructImage(tfWrapper,img,URL,batchsize,padding);
};
  
module.exports = {
    load : load,
    reconstruct : reconstruct
};

