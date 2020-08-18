% Example

% First argument is the 4D input image (bis_image)
% Second argument is struct parameter set
%   mode=2 (band-pass) (1=high-pass, 0=low-pass)
%   low=0.008
%   high=0.2;
%   tr=1.0
%   debug=0
%
% Fourth argument is debug flag
function output=bis_butterworth(input,mode,low,high,tr,debug)

    if nargin<6
        debug=0;
    end

    if (nargin<5)
      tr=1.0;
    end

    if (nargin<4)
      high=0.2;
    end

    if (nargin<3)
      low=0.008;
    end

    if (nargin<2)
      mode=2;
    end

    disp(['Params: mode=',mat2str(mode),' low=',mat2str(low),' high=',mat2str(high),' tr=',mat2str(tr) ]);
    

    orig=input.getImageData();
    dim=size(orig);
    orig = reshape( orig, dim(1)*dim(2)*dim(3), dim(4));
    disp(['Reshaped=',mat2str(size(orig)) ]);

    order = 2;
    
    c_low =  [ high ];
    c_high = [ low ]; 
    fs = 1/tr;

    disp(['Input max=',mat2str(min(min(min(orig)))),' : ',mat2str(max(max(max(orig))))]);
    
    if (mode ~= 1)
      ratio_low = 2*c_low/fs;
      disp([' ------- LOW ']);
      [Bl,Al]=butter(2, ratio_low,'low');
      size(orig)
      orig(1,:)

      disp(['B low=',mat2str(Bl)]);
      disp(['A low=',mat2str(Al)]);
      out_low =  filter(Bl, Al, orig');
      out_low(1,:)
    else
      out_low=orig;
    end

    disp(['Low max=',mat2str(min(min(min(out_low)))),' : ',mat2str(max(max(max(out_low))))]);
    
    if (mode>0)
      ratio_high = 2*c_high/fs;
      disp([' ------- HIGH ']);
      [Bh,Ah]=butter(2, ratio_high,'high');
      disp(['B high=',mat2str(Bh)]);
      disp(['A high=',mat2str(Ah)]);
      out_high = filter(Bh, Ah, out_low);
      disp(['High max=',mat2str(min(min(min(out_high)))),' : ',mat2str(max(max(max(out_high))))]);
    else
      out_high=out_low;
    end


    
    bdat=reshape(out_high',dim(1),dim(2),dim(3),dim(4));
    
    output=bis_image();
    output.create(bdat,input.getSpacing(),input.getAffine());

end